define('bigscreenplayer/subtitles/imscsubtitles',
  [
    'bigscreenplayer/external/smp-imsc',
    'bigscreenplayer/domhelpers',
    'bigscreenplayer/debugger/debugtool',
    'bigscreenplayer/plugins',
    'bigscreenplayer/utils/playbackutils'
  ],
  function (IMSC, DOMHelpers, DebugTool, Plugins, Utils) {
    'use strict';
    return function (mediaPlayer, response, autoStart, parentElement, defaultStyleOpts) {
      var currentSubtitlesElement;
      var exampleSubtitlesElement;
      var previousSubtitlesIndex = null;
      var imscRenderOpts = transformStyleOptions(defaultStyleOpts);
      var updateInterval;
      var xml;
      var times = [];

      try {
        xml = IMSC.fromXML(response.text);
        times = xml.getMediaTimeEvents();
        if (autoStart) {
          start();
        }
      } catch (e) {
        DebugTool.info('Error transforming captions : ' + e);
        Plugins.interface.onSubtitlesTransformError();
      }

      // Opts: { backgroundColour: string (css colour, hex), fontFamily: string , size: number, lineHeight: number }
      function transformStyleOptions (opts) {
        if (opts === undefined) return;

        var customStyles = {};

        if (opts.backgroundColour) {
          customStyles.spanBackgroundColorAdjust = {transparent: opts.backgroundColour};
        }

        if (opts.fontFamily) {
          customStyles.fontFamily = opts.fontFamily;
        }

        if (opts.size) {
          customStyles.sizeAdjust = opts.size;
        }

        if (opts.lineHeight) {
          customStyles.lineHeightAdjust = opts.lineHeight;
        }

        return customStyles;
      }

      function nextSubtitleIndex (currentTime) {
        if (currentTime === undefined || currentTime < times[0]) {
          return null;
        }

        if (currentTime > times[times.length - 1]) {
          return times.length - 1;
        }

        var futureIndices = times.filter(function (time, index) {
          return time > currentTime ? index : null;
        });

        return futureIndices[0];
      }

      function removeCurrentSubtitlesElement () {
        if (currentSubtitlesElement) {
          DOMHelpers.safeRemoveElement(currentSubtitlesElement);
          currentSubtitlesElement = undefined;
        }

        if (exampleSubtitlesElement) {
          DOMHelpers.safeRemoveElement(exampleSubtitlesElement);
          exampleSubtitlesElement = undefined;
        }
      }

      function update (currentTime) {
        var subtitlesIndex = nextSubtitleIndex(currentTime);
        var generateAndRender = subtitlesIndex !== previousSubtitlesIndex;

        if (generateAndRender) {
          render(currentTime);
          previousSubtitlesIndex = subtitlesIndex;
        }
      }

      function render (currentTime) {
        removeCurrentSubtitlesElement();

        currentSubtitlesElement = document.createElement('div');
        currentSubtitlesElement.id = 'bsp_subtitles';
        parentElement.appendChild(currentSubtitlesElement);

        renderHTML(xml, currentTime, parentElement, currentSubtitlesElement, imscRenderOpts);
      }

      function renderExample (xmlString, styleOpts, div, currentTime) {
        removeCurrentSubtitlesElement();

        var exampleXml = IMSC.fromXML(xmlString);
        var customStyleOptions = transformStyleOptions(styleOpts);
        var exampleStyle = Utils.merge(imscRenderOpts, customStyleOptions);

        exampleSubtitlesElement = document.createElement('div');
        exampleSubtitlesElement.id = 'example_subtitles';
        div.appendChild(exampleSubtitlesElement);

        renderHTML(exampleXml, currentTime, div, exampleSubtitlesElement, exampleStyle);
      }

      function renderHTML (xml, currentTime, parent, subsElement, styleOpts) {
        try {
          var isd = IMSC.generateISD(xml, currentTime);
          IMSC.renderHTML(isd, subsElement, null, parent.clientHeight, parent.clientWidth, false, null, null, false, styleOpts);
        } catch (e) {
          DebugTool.info('Exception while rendering subtitles: ' + e);
          Plugins.interface.onSubtitlesRenderError();
        }
      }

      function start () {
        if (xml && times.length > 0) {
          updateInterval = setInterval(function () {
            update(mediaPlayer.getCurrentTime());
          }, 750);
        }
      }

      function stop () {
        clearInterval(updateInterval);
        removeCurrentSubtitlesElement();
      }

      function customise (styleOpts) {
        var customStyleOptions = transformStyleOptions(styleOpts);
        imscRenderOpts = Utils.merge(imscRenderOpts, customStyleOptions);
        render(mediaPlayer.getCurrentTime());
      }

      return {
        start: start,
        stop: stop,
        updatePosition: function () {},
        customise: customise,
        renderExample: renderExample,
        tearDown: function () {
          stop();
          xml = undefined;
          times = undefined;
          previousSubtitlesIndex = undefined;
        }
      };
    };
  }
);
