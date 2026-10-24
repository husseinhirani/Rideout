import type { Language } from '../types'
import { SPEECH_LANG } from './ai'

/**
 * Browser speech for the demo phones. The production voice path is a real phone call
 * (Cartesia TTS + telephony), so this is only here to let a teammate talk to the
 * resident screen during the demo. Swap `speak` for a Cartesia stream when wired up.
 */

export function speak(text: string, lang: Language, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) {
    onEnd?.()
    return
  }
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = SPEECH_LANG[lang]
  u.rate = 0.95
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === u.lang)
  if (voice) u.voice = voice
  if (onEnd) u.onend = onEnd
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

function Recognition(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => RecognitionLike) | undefined
}

export const canListen = () => Boolean(Recognition())

/**
 * Listen for one utterance. `onPartial` streams the live caption; resolves with the final text.
 * Returns a stop function so the UI can cut it short.
 */
export function listen(
  lang: Language,
  onPartial: (text: string) => void,
  onDone: (text: string) => void,
  onError?: (err: string) => void,
): () => void {
  const R = Recognition()
  if (!R) {
    onError?.('Speech recognition is not supported in this browser — type the answer instead.')
    return () => {}
  }
  const rec = new R()
  rec.lang = SPEECH_LANG[lang]
  rec.interimResults = true
  rec.continuous = false
  let finalText = ''
  rec.onresult = (e) => {
    let text = ''
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
    finalText = text
    onPartial(text)
  }
  rec.onerror = (e) => onError?.(e.error)
  rec.onend = () => onDone(finalText.trim())
  rec.start()
  return () => rec.stop()
}
