import MediaState from './models/mediastate'
import WindowTypes from './models/windowtypes'
import PluginData from './plugindata'
import PluginEnums from './pluginenums'
import Plugins from './plugins'
import TransferFormats from './models/transferformats'
import LiveSupport from './models/livesupport'
import PlaybackStrategyModel from './models/playbackstrategy'
import StrategyPicker from './playbackstrategy/strategypicker'

function PlayerComponent (playbackElement, bigscreenPlayerData, mediaSources, windowType, stateUpdateCallback, errorCallback) {
  const transferFormat = bigscreenPlayerData.media.transferFormat

  let mediaKind = bigscreenPlayerData.media.kind
  let isInitialPlay = true
  let errorTimeoutID = null

  let playbackStrategy
  let mediaMetaData
  let fatalErrorTimeout
  let fatalError

  StrategyPicker(windowType, bigscreenPlayerData.media.isUHD).then((strategy) => {
    playbackStrategy = strategy(
      mediaSources,
      windowType,
      mediaKind,
      playbackElement,
      bigscreenPlayerData.media.isUHD,
      bigscreenPlayerData.media.playerSettings
    )

    playbackStrategy.addEventCallback(this, eventCallback)
    playbackStrategy.addErrorCallback(this, onError)
    playbackStrategy.addTimeUpdateCallback(this, onTimeUpdate)

    bubbleErrorCleared()

    initialMediaPlay(bigscreenPlayerData.media, bigscreenPlayerData.initialPlaybackTime)
  }).catch((e) => {
    errorCallback && errorCallback(e)
  })

  function play () {
    playbackStrategy && playbackStrategy.play()
  }

  function isEnded () {
    return playbackStrategy && playbackStrategy.isEnded()
  }

  function pause (opts) {
    opts = opts || {}
    if (transitions().canBePaused()) {
      const disableAutoResume = windowType === WindowTypes.GROWING ? true : opts.disableAutoResume
      playbackStrategy && playbackStrategy.pause({ disableAutoResume: disableAutoResume })
    }
  }

  function getDuration () {
    return playbackStrategy && playbackStrategy.getDuration()
  }

  function getWindowStartTime () {
    return mediaSources && mediaSources.time().windowStartTime
  }

  function getWindowEndTime () {
    return mediaSources && mediaSources.time().windowEndTime
  }

  function getPlayerElement () {
    let element = null
    if (playbackStrategy && playbackStrategy.getPlayerElement) {
      element = playbackStrategy.getPlayerElement()
    }
    return element
  }

  function getCurrentTime () {
    return playbackStrategy && playbackStrategy.getCurrentTime()
  }

  function getSeekableRange () {
    return playbackStrategy && playbackStrategy.getSeekableRange()
  }

  function isPaused () {
    return playbackStrategy && playbackStrategy.isPaused()
  }

  function setCurrentTime (time) {
    if (transitions().canBeginSeek()) {
      isNativeHLSRestartable() ? reloadMediaElement(time) : playbackStrategy && playbackStrategy.setCurrentTime(time)
    }
  }

  function setPlaybackRate (rate) {
    playbackStrategy && playbackStrategy.setPlaybackRate(rate)
  }

  function getPlaybackRate () {
    return playbackStrategy && playbackStrategy.getPlaybackRate()
  }

  function isNativeHLSRestartable () {
    return window.bigscreenPlayer.playbackStrategy === PlaybackStrategyModel.NATIVE &&
             transferFormat === TransferFormats.HLS &&
             windowType !== WindowTypes.STATIC &&
             getLiveSupport() === LiveSupport.RESTARTABLE
  }

  function reloadMediaElement (time) {
    const originalWindowStartOffset = getWindowStartTime()

    const doSeek = () => {
      const windowOffset = mediaSources.time().windowStartTime - originalWindowStartOffset
      const seekableRange = playbackStrategy && playbackStrategy.getSeekableRange()

      let seekToTime = time - windowOffset / 1000
      let thenPause = playbackStrategy && playbackStrategy.isPaused()

      tearDownMediaElement()

      if (seekToTime > seekableRange.end - seekableRange.start - 30) {
        seekToTime = undefined
        thenPause = false
      }
      loadMedia(mediaMetaData.type, seekToTime, thenPause)
    }

    const onError = () => {
      tearDownMediaElement()
      bubbleFatalError(false)
    }

    mediaSources.refresh(doSeek, onError)
  }

  function transitions () {
    return playbackStrategy && playbackStrategy.transitions
  }

  function tearDownMediaElement () {
    clearTimeouts()
    playbackStrategy && playbackStrategy.reset()
  }

  function eventCallback (mediaState) {
    switch (mediaState) {
      case MediaState.PLAYING:
        onPlaying()
        break
      case MediaState.PAUSED:
        onPaused()
        break
      case MediaState.WAITING:
        onBuffering()
        break
      case MediaState.ENDED:
        onEnded()
        break
    }
  }

  function onPlaying () {
    clearTimeouts()
    publishMediaStateUpdate(MediaState.PLAYING, {})
    isInitialPlay = false
  }

  function onPaused () {
    publishMediaStateUpdate(MediaState.PAUSED)
    clearTimeouts()
  }

  function onBuffering () {
    publishMediaStateUpdate(MediaState.WAITING)
    startBufferingErrorTimeout()
    bubbleErrorCleared()
    bubbleBufferingRaised()
  }

  function onEnded () {
    clearTimeouts()
    publishMediaStateUpdate(MediaState.ENDED)
  }

  function onTimeUpdate () {
    publishMediaStateUpdate(undefined, { timeUpdate: true })
  }

  function onError () {
    bubbleBufferingCleared()
    raiseError()
  }

  function startBufferingErrorTimeout () {
    const bufferingTimeout = isInitialPlay ? 30000 : 20000
    clearBufferingErrorTimeout()
    errorTimeoutID = setTimeout(() => {
      bubbleBufferingCleared()
      attemptCdnFailover(true)
    }, bufferingTimeout)
  }

  function raiseError () {
    clearBufferingErrorTimeout()
    publishMediaStateUpdate(MediaState.WAITING)
    bubbleErrorRaised()
    startFatalErrorTimeout()
  }

  function startFatalErrorTimeout () {
    if (!fatalErrorTimeout && !fatalError) {
      fatalErrorTimeout = setTimeout(() => {
        fatalErrorTimeout = null
        fatalError = true
        attemptCdnFailover(false)
      }, 5000)
    }
  }

  function attemptCdnFailover (bufferingTimeoutError) {
    const time = getCurrentTime()
    const oldWindowStartTime = getWindowStartTime()

    const failoverParams = {
      errorMessage: bufferingTimeoutError ? 'bufferingTimeoutError' : 'fatalError',
      isBufferingTimeoutError: bufferingTimeoutError,
      currentTime: getCurrentTime(),
      duration: getDuration()
    }

    const doLoadMedia = () => {
      const thenPause = isPaused()
      const windowOffset = (mediaSources.time().windowStartTime - oldWindowStartTime) / 1000
      const failoverTime = time - (windowOffset || 0)
      tearDownMediaElement()
      loadMedia(mediaMetaData.type, failoverTime, thenPause)
    }

    const doErrorCallback = () => {
      bubbleFatalError(bufferingTimeoutError)
    }

    mediaSources.failover(doLoadMedia, doErrorCallback, failoverParams)
  }

  function clearFatalErrorTimeout () {
    if (fatalErrorTimeout !== null) {
      clearTimeout(fatalErrorTimeout)
      fatalErrorTimeout = null
    }
  }

  function clearBufferingErrorTimeout () {
    if (errorTimeoutID !== null) {
      clearTimeout(errorTimeoutID)
      errorTimeoutID = null
    }
  }

  function clearTimeouts () {
    clearBufferingErrorTimeout()
    clearFatalErrorTimeout()
    fatalError = false
    bubbleBufferingCleared()
    bubbleErrorCleared()
  }

  function bubbleErrorCleared () {
    const evt = new PluginData({ status: PluginEnums.STATUS.DISMISSED, stateType: PluginEnums.TYPE.ERROR })
    Plugins.interface.onErrorCleared(evt)
  }

  function bubbleErrorRaised () {
    const evt = new PluginData({ status: PluginEnums.STATUS.STARTED, stateType: PluginEnums.TYPE.ERROR, isBufferingTimeoutError: false })
    Plugins.interface.onError(evt)
  }

  function bubbleBufferingRaised () {
    const evt = new PluginData({ status: PluginEnums.STATUS.STARTED, stateType: PluginEnums.TYPE.BUFFERING })
    Plugins.interface.onBuffering(evt)
  }

  function bubbleBufferingCleared () {
    const evt = new PluginData({ status: PluginEnums.STATUS.DISMISSED, stateType: PluginEnums.TYPE.BUFFERING, isInitialPlay: isInitialPlay })
    Plugins.interface.onBufferingCleared(evt)
  }

  function bubbleFatalError (bufferingTimeoutError) {
    const evt = new PluginData({ status: PluginEnums.STATUS.FATAL, stateType: PluginEnums.TYPE.ERROR, isBufferingTimeoutError: bufferingTimeoutError })
    Plugins.interface.onFatalError(evt)
    publishMediaStateUpdate(MediaState.FATAL_ERROR, { isBufferingTimeoutError: bufferingTimeoutError })
  }

  function publishMediaStateUpdate (state, opts) {
    const mediaData = {}
    mediaData.currentTime = getCurrentTime()
    mediaData.seekableRange = getSeekableRange()
    mediaData.state = state
    mediaData.duration = getDuration()

    stateUpdateCallback({ data: mediaData, timeUpdate: opts && opts.timeUpdate, isBufferingTimeoutError: (opts && opts.isBufferingTimeoutError || false) })
  }

  function initialMediaPlay (media, startTime) {
    mediaMetaData = media
    loadMedia(media.type, startTime)
  }

  function loadMedia (type, startTime, thenPause) {
    playbackStrategy && playbackStrategy.load(type, startTime)
    if (thenPause) {
      pause()
    }
  }

  function tearDown () {
    tearDownMediaElement()
    playbackStrategy && playbackStrategy.tearDown()
    playbackStrategy = null
    isInitialPlay = true
    errorTimeoutID = undefined
    windowType = undefined
    mediaKind = undefined
    stateUpdateCallback = undefined
    mediaMetaData = undefined
    fatalErrorTimeout = undefined
    fatalError = undefined
  }

  return {
    play: play,
    pause: pause,
    transitions: transitions,
    isEnded: isEnded,
    setPlaybackRate: setPlaybackRate,
    getPlaybackRate: getPlaybackRate,
    setCurrentTime: setCurrentTime,
    getCurrentTime: getCurrentTime,
    getDuration: getDuration,
    getWindowStartTime: getWindowStartTime,
    getWindowEndTime: getWindowEndTime,
    getSeekableRange: getSeekableRange,
    getPlayerElement: getPlayerElement,
    isPaused: isPaused,
    tearDown: tearDown
  }
}

function getLiveSupport () {
  return window.bigscreenPlayer &&
    window.bigscreenPlayer.liveSupport ||
    LiveSupport.SEEKABLE
}

PlayerComponent.getLiveSupport = getLiveSupport

export default PlayerComponent
