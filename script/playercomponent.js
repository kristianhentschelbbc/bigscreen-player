import MediaState from "./models/mediastate";
import Subtitles from "./subtitles/subtitles";
import WindowTypes from "./models/windowtypes";
import PluginData from "./plugindata";
import PluginEnums from "./pluginenums";
import Plugins from "./plugins";
import TransferFormats from "./models/transferformats";
import LiveSupport from "./models/livesupport";
import PlaybackStrategyModel from "./models/playbackstrategy";
import LegacyAdapter from "./playbackstrategy/legacyplayeradapter";
import SeekableModifier from "./playbackstrategy/modifiers/live/seekable";

var PlayerComponent = function (playbackElement, bigscreenPlayerData, mediaSources, windowType, enableSubtitles, callback) {
  var isInitialPlay = true;
  var captionsURL = bigscreenPlayerData.media.captionsUrl;
  var errorTimeoutID = null;
  var mediaKind = bigscreenPlayerData.media.kind;
  var stateUpdateCallback = callback;
  var playbackStrategy;
  var subtitles;
  var mediaMetaData;
  var fatalErrorTimeout;
  var fatalError;
  var transferFormat = bigscreenPlayerData.media.transferFormat;

  var liveSupport = window.bigscreenPlayer && window.bigscreenPlayer.liveSupport || 'seekable';
  var resolvedMediaPlayer = 'mse';

  if (window.bigscreenPlayer && window.bigscreenPlayer.playbackStrategy === 'nativestrategy') {
    if (window.bigscreenPlayer && window.bigscreenPlayer.mediaPlayer) {
      resolvedMediaPlayer = window.bigscreenPlayer && window.bigscreenPlayer.mediaPlayer;
    } else {
      resolvedMediaPlayer = 'html5'; 
    }
  }

  switch (resolvedMediaPlayer) {
    case 'cehtml':
      import('./playbackstrategy/modifiers/cehtml').then((CEHTML) => {
        init(generateLegacyMediaPlayer(CEHTML.default, liveSupport));
      })
      break;
    case 'samsungstreaming':
      import('./playbackstrategy/modifiers/samsungstreaming').then((SamsungStreaming) => {
        init(generateLegacyMediaPlayer(SamsungStreaming.default, liveSupport));
      })
      break;
    case 'samsungstreaming2015':
      import('./playbackstrategy/modifiers/samsungstreaming2015').then((SamsungStreaming2015) => {
        init(generateLegacyMediaPlayer(SamsungStreaming2015.default, liveSupport));
      })
      break;
    case 'samsungmaple':
      import('./playbackstrategy/modifiers/samsungmaple').then((SamsungMaple) => {
        init(generateLegacyMediaPlayer(SamsungMaple.default, liveSupport));
      })
      break;
    case 'html5':
      import('./playbackstrategy/modifiers/html5').then((HTML5) => {
        init(generateLegacyMediaPlayer(HTML5.default, liveSupport));
      })
      break;
    case 'mse':
      import("./playbackstrategy/msestrategy").then((MSEStrategy) => {
        var strategy  = MSEStrategy.default(
          mediaSources,
          windowType,
          mediaKind,
          playbackElement,
          bigscreenPlayerData.media.isUHD
        );
        init(strategy);
      })
  }

  function generateLegacyMediaPlayer(mediaPlayer, liveSupport) {

    // ignore liveSupport for now, just be seekable
    if (windowType !== WindowTypes.STATIC) {
      mediaPlayer = SeekableModifier.default(mediaPlayer, windowType, mediaSources);
    }
  
    return LegacyAdapter(mediaSources, windowType, playbackElement, bigscreenPlayerData.media.isUHD, mediaPlayer)
  }

  
  function init(strategy) {
    playbackStrategy = strategy;
    playbackStrategy.addEventCallback(this, eventCallback);
    playbackStrategy.addErrorCallback(this, onError);
    playbackStrategy.addTimeUpdateCallback(this, onTimeUpdate);
  
    bubbleErrorCleared();
  
    subtitles = Subtitles(playbackStrategy, captionsURL, enableSubtitles, playbackElement);
    initialMediaPlay(bigscreenPlayerData.media, bigscreenPlayerData.initialPlaybackTime);
  }

  function play () {
    playbackStrategy.play();
  }

  function isEnded () {
    return playbackStrategy.isEnded();
  }

  function pause (opts) {
    opts = opts || {};
    if (transitions().canBePaused()) {
      var disableAutoResume = windowType === WindowTypes.GROWING ? true : opts.disableAutoResume;
      playbackStrategy.pause({ disableAutoResume: disableAutoResume });
    }
  }

  function getDuration () {
    return playbackStrategy.getDuration();
  }

  function getWindowStartTime () {
    return mediaSources && mediaSources.time().windowStartTime;
  }

  function getWindowEndTime () {
    return mediaSources && mediaSources.time().windowEndTime;
  }

  function getPlayerElement () {
    var element = null;
    if (playbackStrategy && playbackStrategy.getPlayerElement) {
      element = playbackStrategy.getPlayerElement();
    }
    return element;
  }

  function getCurrentTime () {
    return playbackStrategy.getCurrentTime();
  }

  function getSeekableRange () {
    return playbackStrategy.getSeekableRange();
  }

  function setSubtitlesEnabled (enabled) {
    enabled ? subtitles.enable() : subtitles.disable();
  }

  function showSubtitles () {
    subtitles.show();
  }

  function hideSubtitles () {
    subtitles.hide();
  }

  function isSubtitlesEnabled () {
    return subtitles.enabled();
  }

  function isSubtitlesAvailable () {
    return subtitles.available();
  }

  function setTransportControlPosition (flags) {
    subtitles.setPosition(flags);
  }

  function isPaused () {
    return playbackStrategy.isPaused();
  }

  function setCurrentTime (time) {
    if (transitions().canBeginSeek()) {
      isNativeHLSRestartable() ? reloadMediaElement(time) : playbackStrategy.setCurrentTime(time);
    }
  }

  function isNativeHLSRestartable () {
    return window.bigscreenPlayer.playbackStrategy === PlaybackStrategyModel.NATIVE &&
           transferFormat === TransferFormats.HLS &&
           windowType !== WindowTypes.STATIC &&
           getLiveSupport() === LiveSupport.RESTARTABLE;
  }

  function reloadMediaElement (time) {
    var originalWindowStartOffset = getWindowStartTime();

    var doSeek = function () {
      var windowOffset = mediaSources.time().windowStartTime - originalWindowStartOffset;
      var seekToTime = time - windowOffset / 1000;

      var thenPause = playbackStrategy.isPaused();
      var seekableRange = playbackStrategy.getSeekableRange();
      tearDownMediaElement();

      if (seekToTime > seekableRange.end - seekableRange.start - 30) {
        seekToTime = undefined;
        thenPause = false;
      }
      loadMedia(mediaMetaData.type, seekToTime, thenPause);
    };

    var onError = function () {
      tearDownMediaElement();
      bubbleFatalError(false);
    };

    mediaSources.refresh(doSeek, onError);
  }

  function transitions () {
    return playbackStrategy.transitions;
  }

  function tearDownMediaElement () {
    clearTimeouts();
    playbackStrategy.reset();
  }

  function eventCallback (mediaState) {
    switch (mediaState) {
      case MediaState.PLAYING:
        onPlaying();
        break;
      case MediaState.PAUSED:
        onPaused();
        break;
      case MediaState.WAITING:
        onBuffering();
        break;
      case MediaState.ENDED:
        onEnded();
        break;
    }
  }

  function onPlaying () {
    clearTimeouts();
    publishMediaStateUpdate(MediaState.PLAYING, {});
    isInitialPlay = false;
  }

  function onPaused () {
    publishMediaStateUpdate(MediaState.PAUSED);
    clearTimeouts();
  }

  function onBuffering () {
    publishMediaStateUpdate(MediaState.WAITING);
    startBufferingErrorTimeout();
    bubbleErrorCleared();
    bubbleBufferingRaised();
  }

  function onEnded () {
    clearTimeouts();
    publishMediaStateUpdate(MediaState.ENDED);
  }

  function onTimeUpdate () {
    publishMediaStateUpdate(undefined, { timeUpdate: true });
  }

  function onError () {
    bubbleBufferingCleared();
    raiseError();
  }

  function startBufferingErrorTimeout () {
    var bufferingTimeout = isInitialPlay ? 30000 : 20000;
    clearBufferingErrorTimeout();
    errorTimeoutID = setTimeout(function () {
      bubbleBufferingCleared();
      attemptCdnFailover(true);
    }, bufferingTimeout);
  }

  function raiseError () {
    clearBufferingErrorTimeout();
    publishMediaStateUpdate(MediaState.WAITING);
    bubbleErrorRaised();
    startFatalErrorTimeout();
  }

  function startFatalErrorTimeout () {
    if (!fatalErrorTimeout && !fatalError) {
      fatalErrorTimeout = setTimeout(function () {
        fatalErrorTimeout = null;
        fatalError = true;
        attemptCdnFailover(false);
      }, 5000);
    }
  }

  function attemptCdnFailover (bufferingTimeoutError) {
    var time = getCurrentTime();
    var oldWindowStartTime = getWindowStartTime();

    var failoverParams = {
      errorMessage: bufferingTimeoutError ? 'bufferingTimeoutError' : 'fatalError',
      isBufferingTimeoutError: bufferingTimeoutError,
      currentTime: getCurrentTime(),
      duration: getDuration()
    };

    var doLoadMedia = function () {
      var thenPause = isPaused();
      var windowOffset = (mediaSources.time().windowStartTime - oldWindowStartTime) / 1000;
      var failoverTime = time - (windowOffset || 0);
      tearDownMediaElement();
      loadMedia(mediaMetaData.type, failoverTime, thenPause);
    };

    var doErrorCallback = function () {
      bubbleFatalError(bufferingTimeoutError);
    };

    mediaSources.failover(doLoadMedia, doErrorCallback, failoverParams);
  }

  function clearFatalErrorTimeout () {
    if (fatalErrorTimeout !== null) {
      clearTimeout(fatalErrorTimeout);
      fatalErrorTimeout = null;
    }
  }

  function clearBufferingErrorTimeout () {
    if (errorTimeoutID !== null) {
      clearTimeout(errorTimeoutID);
      errorTimeoutID = null;
    }
  }

  function clearTimeouts () {
    clearBufferingErrorTimeout();
    clearFatalErrorTimeout();
    fatalError = false;
    bubbleBufferingCleared();
    bubbleErrorCleared();
  }

  function bubbleErrorCleared () {
    var evt = new PluginData({ status: PluginEnums.STATUS.DISMISSED, stateType: PluginEnums.TYPE.ERROR });
    Plugins.interface.onErrorCleared(evt);
  }

  function bubbleErrorRaised () {
    var evt = new PluginData({ status: PluginEnums.STATUS.STARTED, stateType: PluginEnums.TYPE.ERROR, isBufferingTimeoutError: false });
    Plugins.interface.onError(evt);
  }

  function bubbleBufferingRaised () {
    var evt = new PluginData({ status: PluginEnums.STATUS.STARTED, stateType: PluginEnums.TYPE.BUFFERING });
    Plugins.interface.onBuffering(evt);
  }

  function bubbleBufferingCleared () {
    var evt = new PluginData({ status: PluginEnums.STATUS.DISMISSED, stateType: PluginEnums.TYPE.BUFFERING, isInitialPlay: isInitialPlay });
    Plugins.interface.onBufferingCleared(evt);
  }

  function bubbleFatalError (bufferingTimeoutError) {
    var evt = new PluginData({ status: PluginEnums.STATUS.FATAL, stateType: PluginEnums.TYPE.ERROR, isBufferingTimeoutError: bufferingTimeoutError });
    Plugins.interface.onFatalError(evt);
    publishMediaStateUpdate(MediaState.FATAL_ERROR, { isBufferingTimeoutError: bufferingTimeoutError });
  }

  function publishMediaStateUpdate (state, opts) {
    var mediaData = {};
    mediaData.currentTime = getCurrentTime();
    mediaData.seekableRange = getSeekableRange();
    mediaData.subtitles = {
      enabled: isSubtitlesEnabled(),
      available: isSubtitlesAvailable()
    };
    mediaData.state = state;
    mediaData.duration = getDuration();

    stateUpdateCallback({ data: mediaData, timeUpdate: opts && opts.timeUpdate, isBufferingTimeoutError: (opts && opts.isBufferingTimeoutError || false) });
  }

  function initialMediaPlay (media, startTime) {
    mediaMetaData = media;
    loadMedia(media.type, startTime);
  }

  function loadMedia (type, startTime, thenPause) {
    playbackStrategy.load(type, startTime);
    if (thenPause) {
      pause();
    }
  }

  function tearDown () {
    tearDownMediaElement();

    playbackStrategy.tearDown();
    playbackStrategy = null;

    subtitles.tearDown();
    subtitles = null;

    isInitialPlay = true;
    captionsURL = undefined;
    errorTimeoutID = undefined;
    windowType = undefined;
    mediaKind = undefined;
    stateUpdateCallback = undefined;
    mediaMetaData = undefined;
    fatalErrorTimeout = undefined;
    fatalError = undefined;
  }

  return {
    play: play,
    pause: pause,
    transitions: transitions,
    isEnded: isEnded,
    setCurrentTime: setCurrentTime,
    getCurrentTime: getCurrentTime,
    getDuration: getDuration,
    getWindowStartTime: getWindowStartTime,
    getWindowEndTime: getWindowEndTime,
    getSeekableRange: getSeekableRange,
    getPlayerElement: getPlayerElement,
    isSubtitlesAvailable: isSubtitlesAvailable,
    showSubtitles: showSubtitles,
    hideSubtitles: hideSubtitles,
    isSubtitlesEnabled: isSubtitlesEnabled,
    setSubtitlesEnabled: setSubtitlesEnabled,
    isPaused: isPaused,
    setTransportControlPosition: setTransportControlPosition,
    tearDown: tearDown
  };
};

function getLiveSupport () {
  return 'seekable';
}

PlayerComponent.getLiveSupport = getLiveSupport;

export default PlayerComponent;
