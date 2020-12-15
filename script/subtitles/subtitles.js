import SubtitlesContainer from "./imscsubtitles";
import LoadURL from "../utils/loadurl";
import DebugTool from "../debugger/debugtool";
import Plugins from "../plugins";

// playbackStrategy, captionsURL, isSubtitlesEnabled(), playbackElement TODO: change the ordering of this, doesn't make sense.
export default function (mediaPlayer, url, autoStart, playbackElement) {
  var subtitlesContainer;
var subtitlesEnabled = autoStart;
  var subtitlesAvailable = !!url;

  if (subtitlesAvailable) {
    DebugTool.info('Loading subtitles from: ' + url);
    LoadURL(url, {
      onLoad: function (responseXML, responseText, status) {
        if (!responseXML) {
          DebugTool.info('Error: responseXML is invalid.');
          Plugins.interface.onSubtitlesTransformError();
          return;
        }

        var response = {
          text: responseText,
          xml: responseXML
        };

        if (status === 200) {
          subtitlesContainer = SubtitlesContainer(mediaPlayer, response, autoStart, playbackElement);
        }
      },
      onError: function (error) {
        DebugTool.info('Error loading subtitles data: ' + error);
        Plugins.interface.onSubtitlesLoadError();
      }
    });
  }

  function enable () {
    subtitlesEnabled = true;
  }

  function disable () {
    subtitlesEnabled = false;
  }

  function show () {
    if (available() && enabled() && subtitlesContainer) {
      subtitlesContainer.start();
    }
  }

  function hide () {
    if (available() && subtitlesContainer) {
      subtitlesContainer.stop();
    }
  }

  function enabled () {
    return subtitlesEnabled;
  }

  function available () {
    return subtitlesAvailable;
  }

  function setPosition (position) {
    if (subtitlesContainer) {
      subtitlesContainer.updatePosition(position);
    }
  }

  function tearDown () {
    if (subtitlesContainer) {
      subtitlesContainer.tearDown();
    }
  }

  return {
    enable: enable,
    disable: disable,
    show: show,
    hide: hide,
    enabled: enabled,
    available: available,
    setPosition: setPosition,
    tearDown: tearDown
  };
};
