import LegacySubtitles from './legacysubtitles'
import TransportControlPosition from '../models/transportcontrolposition'
import LoadUrl from '../utils/loadurl'
import Plugins from '../plugins'
import Renderer from './renderer'
'use strict'

jest.mock('../utils/loadurl')

jest.mock('../plugins', () => {
  return {
    interface: {
      onSubtitlesTimeout: jest.fn(),
      onSubtitlesXMLError: jest.fn(),
      onSubtitlesRenderError: jest.fn(),
      onSubtitlesTransformError: jest.fn()
    }
  }
})

const mockStart = jest.fn()
const mockStop = jest.fn()
const mockRender = () => {
  return document.createElement('div')
}
jest.mock('./renderer')

Renderer.mockImplementation(() => {
  return {
    start: mockStart,
    stop: mockStop,
    render: mockRender
  }
})

var legacySubtitles
var parentElement = document.createElement('div')
var loadUrlStubResponseXml = '<?xml>'
var loadUrlStubResponseText = 'loadUrlStubResponseText'

var subtitlesUrl
var subtitlesCdn
var mockMediaSources
const mockMediaPlayer = {
  getDuration: jest.fn()
}
var avalailableSourceCount

describe('Legacy Subtitles', function () {
  beforeEach(function () {
    LoadUrl.mockImplementation(function (url, callbackObject) {
      callbackObject.onLoad(loadUrlStubResponseXml, loadUrlStubResponseText, 200)
    })

    subtitlesUrl = 'http://stub-captions.test'
    subtitlesCdn = 'supplier1'
    mockMediaSources = {
      'currentSubtitlesSource': jest.fn(),
      'failoverSubtitles': jest.fn(),
      'subtitlesRequestTimeout': jest.fn(),
      'currentSubtitlesCdn': jest.fn()
    }
    mockMediaSources.currentSubtitlesSource.mockReturnValue(subtitlesUrl)
    mockMediaSources.currentSubtitlesCdn.mockReturnValue(subtitlesCdn)
    mockMediaSources.failoverSubtitles.mockImplementation(function (postFailoverAction, failoverErrorAction) {
      if (avalailableSourceCount > 1) {
        avalailableSourceCount--
        postFailoverAction()
      } else {
        failoverErrorAction()
      }
    })
  })

  afterEach(function () {
    legacySubtitles.tearDown()
    LoadUrl.mockClear()
    Renderer.mockClear()
    mockStart.mockClear()
    mockStop.mockClear()
  })

  it('Should load the subtitles url if auto start is true', function () {
    var autoStart = true
    legacySubtitles = LegacySubtitles(mockMediaPlayer, autoStart, parentElement, mockMediaSources)

    expect(LoadUrl).toHaveBeenCalledWith(subtitlesUrl, expect.any(Object))
  })

  it('Should not load the subtitles url if auto start is false', function () {
    var autoStart = false
    legacySubtitles = LegacySubtitles(mockMediaPlayer, autoStart, parentElement, mockMediaSources)

    expect(LoadUrl).not.toHaveBeenCalled()
  })

  it('Has a player subtitles class', function () {
    legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)

    expect(parentElement.firstChild.className).toContain('playerCaptions')
  })

  it('Should fire subtitlesXMLError if responseXML from the loader is invalid', function () {
    LoadUrl.mockImplementation(function (url, callbackObject) {
      callbackObject.onLoad(null, '', 200)
    })
    legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)

    expect(Plugins.interface.onSubtitlesXMLError).toHaveBeenCalledWith({cdn: subtitlesCdn})
    expect(Plugins.interface.onSubtitlesXMLError).toHaveBeenCalledTimes(1)
  })

  it('Should try to failover to the next url if responseXML from the loader is invalid', function () {
    avalailableSourceCount = 1
    LoadUrl.mockImplementation(function (url, callbackObject) {
      callbackObject.onError(404)
    })
    legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)

    expect(mockMediaSources.failoverSubtitles).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), 404)
    expect(mockMediaSources.failoverSubtitles).toHaveBeenCalledTimes(1)
  })

  it('Should fire onSubtitlesTimeout if the XHR times out', function () {
    LoadUrl.mockImplementation(function (url, callbackObject) {
      callbackObject.onTimeout()
    })
    legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)

    expect(Plugins.interface.onSubtitlesTimeout).toHaveBeenCalledWith({cdn: subtitlesCdn})
    expect(Plugins.interface.onSubtitlesTimeout).toHaveBeenCalledTimes(1)
  })

  describe('Start', function () {
    it('Should call start on the renderer when the renderer exists', function () {
      legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)

      legacySubtitles.start()

      expect(mockStart).toHaveBeenCalledWith()
    })

    it('Should load the subtitle url and create the renderer when the renderer doesnt exist', function () {
      legacySubtitles = LegacySubtitles(mockMediaPlayer, false, parentElement, mockMediaSources)

      legacySubtitles.start()

      expect(LoadUrl).toHaveBeenCalledWith(subtitlesUrl, expect.any(Object))
      expect(Renderer).toHaveBeenCalledWith('playerCaptions', expect.any(String), mockMediaPlayer)
    })

    it('Should not start subtitles if there is invalid xml in the response object', function () {
      LoadUrl.mockImplementation(function (url, callbackObject) {
        callbackObject.onError()
      })
      legacySubtitles = LegacySubtitles(mockMediaPlayer, false, parentElement, mockMediaSources)

      legacySubtitles.start()

      expect(Renderer).not.toHaveBeenCalled()
    })
  })

  describe('Stop', function () {
    it('Stops the subtitles if there is valid xml in the response object', function () {
      legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)
      legacySubtitles.stop()

      expect(mockStop).toHaveBeenCalledWith()
    })

    it('Does not stop the subtitles if there is is invalid xml in the response object', function () {
      LoadUrl.mockImplementation(function (url, callbackObject) {
        callbackObject.onError()
      })

      legacySubtitles = new LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)
      legacySubtitles.stop()

      expect(mockStop).not.toHaveBeenCalledWith()
    })
  })

  describe('Updating position', function () {
    beforeEach(() => {
      legacySubtitles = LegacySubtitles(mockMediaPlayer, true, parentElement, mockMediaSources)
    })

    // each([
    //   {className: 'controlsVisible', pos: TransportControlPosition.CONTROLS_ONLY},
    //   {className: 'controlsWithInfoVisible', pos: TransportControlPosition.CONTROLS_WITH_INFO},
    //   {className: 'leftCarouselVisible', pos: TransportControlPosition.LEFT_CAROUSEL},
    //   {className: 'bottomCarouselVisible', pos: TransportControlPosition.BOTTOM_CAROUSEL}])('Has class $position.className for position $position.pos', function (position) {
    //   legacySubtitles.updatePosition(position.pos)

    //   expect(parentElement.firstChild.className).toContain(position.className)
    // })

    it('Replaces classes when position changed', function () {
      legacySubtitles.updatePosition(TransportControlPosition.CONTROLS_ONLY)

      expect(parentElement.firstChild.className).toContain('controlsVisible')
      legacySubtitles.updatePosition(TransportControlPosition.CONTROLS_WITH_INFO)

      expect(parentElement.firstChild.className).not.toContain('controlsVisible')
    })
  })
})
