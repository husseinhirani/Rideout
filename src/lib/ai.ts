import type { Interpretation, Language, Need } from '../types'

/**
 * Stand-in for the Claude call that reads a resident's answer.
 *
 * In production this runs server-side: the voice agent's transcript goes to Claude with a
 * tool schema shaped like `Interpretation`, and the result is written to the backend.
 * This keyword version exists so the frontend demo works offline and deterministically.
 * Swap `interpret` for a fetch to your backend when it's ready — callers already treat
 * the result as data, not as a promise of correctness (low confidence → ask again).
 */
/** Whole-word match that also works for accented words (\b is ASCII-only in JS). */
const word = (w: string) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u')

export function interpret(text: string): Interpretation {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `
  const evidence: string[] = []
  const hit = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const m = t.match(p)
      if (m) {
        evidence.push(m[0].trim())
        return true
      }
    }
    return false
  }

  const needs: Need[] = []
  if (hit([/walker/, /\bcane\b/, /andador/, /bastón/, /khung tập đi/, /gậy/, /助行架/, /拐杖/])) needs.push('walker')
  if (hit([/wheel ?chair/, /silla de ruedas/, /xe lăn/, /輪椅/])) needs.push('wheelchair')
  if (hit([/oxygen/, /oxígeno/, /bình dưỡng khí/, /oxy/, /氧氣/])) needs.push('oxygen')
  if (hit([/\bdog\b/, /\bcat\b/, /\bpets?\b/, /biscuit/, /perr[oa]/, /gat[oa]/, word('chó'), word('mèo'), /狗/, /貓/])) needs.push('pets')
  const noCar = hit([
    /no (tengo )?(car|carro|coche)/,
    /don't have a car/,
    /has the car/,
    /can't drive/,
    /cannot drive/,
    /don't drive/,
    /no (puedo )?manejar/,
    /không có xe/,
    /không lái/,
    /冇車/,
    /唔識揸車/,
  ])
  if (noCar) needs.push('no_car')

  const hasRide = hit([
    /(coming|on (his|her|their) way) (for|to get|to pick up) me/,
    /picking me up/,
    /ya viene/,
    /viene por mí/,
    /me (va a )?recoge/,
    /đang đến đón/,
    /(仔|女|老公|老婆|屋企人|鄰居).{0,4}(來|嚟)接我/,
    /with my neighbor/,
    /(son|daughter|husband|wife|neighbor)('s)? (is )?(coming|driving me)/,
  ])

  const cantLeave = hit([
    /can't (get out|leave|go|walk|get down|make it|move)/,
    /cannot (get out|leave|go|walk)/,
    /not able to/,
    /unable to/,
    /\bstuck\b/,
    /need (a ride|help|someone)/,
    /pick me up/,
    /i'm not going anywhere/,
    /not leaving without/,
    /no puedo (salir|ir|caminar)/,
    /necesito (ayuda|que)/,
    /không thể/,
    /cần người/,
    /走唔到/,
    /唔可以離開/,
    /需要/,
    /\bi can't\b/,
  ])

  const canLeave = hit([
    /\byes\b/,
    /\byeah\b/,
    /i'm (going|leaving|fine|okay|ok)/,
    /i can (leave|go|drive)/,
    /i'll (drive|leave|go)/,
    /on my way/,
    word('sí'),
    /ya (salgo|me voy)/,
    word('có'),
    /đi được/,
    /可以/,
  ])

  let canLeaveResult: boolean | null
  let confidence: number
  if (hasRide) {
    canLeaveResult = true
    confidence = 0.9
  } else if (cantLeave || (noCar && needs.length > 0)) {
    canLeaveResult = false
    confidence = cantLeave && noCar ? 0.96 : 0.88
  } else if (noCar) {
    // "I don't have a car" on its own is a strong signal they need a ride.
    canLeaveResult = false
    confidence = 0.82
  } else if (canLeave) {
    canLeaveResult = true
    confidence = 0.84
  } else if (/\bno\b/.test(t)) {
    canLeaveResult = false
    confidence = 0.6
  } else {
    canLeaveResult = null
    confidence = 0.3
  }

  return {
    canLeave: canLeaveResult,
    hasRide,
    needs,
    confidence,
    evidence: [...new Set(evidence)].slice(0, 4),
    summary: summarize(canLeaveResult, hasRide, needs),
  }
}

function summarize(canLeave: boolean | null, hasRide: boolean, needs: Need[]): string {
  if (canLeave === null) return 'Unclear answer — asking again.'
  if (hasRide) return 'Has a ride on the way. No pickup needed.'
  if (canLeave) return 'Able to leave independently.'
  const parts: string[] = []
  if (needs.includes('wheelchair')) parts.push('uses a wheelchair')
  else if (needs.includes('walker')) parts.push('uses a walker')
  if (needs.includes('oxygen')) parts.push('on oxygen')
  if (needs.includes('no_car')) parts.push('no car')
  if (needs.includes('pets')) parts.push('has a pet that must come')
  return `Can't leave without help${parts.length ? ' — ' + parts.join(', ') : ''}.`
}

/* ---------- What the voice agent says, per language ---------- */

const COLORS: Record<string, Record<Language, string>> = {
  gray: { en: 'gray', es: 'gris', vi: 'màu xám', zh: '灰色' },
  white: { en: 'white', es: 'blanco', vi: 'màu trắng', zh: '白色' },
  green: { en: 'green', es: 'verde', vi: 'màu xanh lá', zh: '綠色' },
  red: { en: 'red', es: 'rojo', vi: 'màu đỏ', zh: '紅色' },
  blue: { en: 'blue', es: 'azul', vi: 'màu xanh dương', zh: '藍色' },
  black: { en: 'black', es: 'negro', vi: 'màu đen', zh: '黑色' },
}

const color = (c: string, lang: Language) => COLORS[c]?.[lang] ?? c

interface Line {
  text: string
  translation?: string
}

function line(lang: Language, by: Record<Language, string>): Line {
  return lang === 'en' ? { text: by.en } : { text: by[lang], translation: by.en }
}

export const agent = {
  greeting: (first: string, lang: Language): Line =>
    line(lang, {
      en: `Hello ${first}. This is a safety check from RideOut. There is a wildfire near your home and your area has an evacuation warning. Are you able to leave right now?`,
      es: `Hola ${first}. Esta es una llamada de seguridad de RideOut. Hay un incendio cerca de su casa y su zona tiene aviso de evacuación. ¿Puede salir ahora mismo?`,
      vi: `Xin chào ${first}. Đây là cuộc gọi kiểm tra an toàn từ RideOut. Có cháy rừng gần nhà bạn và khu vực của bạn có lệnh sơ tán. Bạn có thể rời đi ngay bây giờ không?`,
      zh: `${first}你好，呢個係RideOut嘅安全確認電話。你屋企附近有山火，你嘅地區有疏散警告。你而家可唔可以自己離開？`,
    }),

  clarify: (lang: Language): Line =>
    line(lang, {
      en: "I'm sorry, I want to be sure I understood. Do you need someone to come and pick you up? Please say yes or no.",
      es: 'Disculpe, quiero asegurarme de entender. ¿Necesita que alguien venga a recogerle? Por favor diga sí o no.',
      vi: 'Xin lỗi, tôi muốn chắc chắn là tôi hiểu đúng. Bạn có cần người đến đón không? Xin hãy nói có hoặc không.',
      zh: '唔好意思，我想確認我冇聽錯。你需唔需要有人嚟接你？請講需要或者唔需要。',
    }),

  needsHelp: (lang: Language, needs: Need[]): Line => {
    const aid = needs.includes('wheelchair') ? 'wheelchair' : needs.includes('walker') ? 'walker' : null
    return line(lang, {
      en: `Okay. I heard that you can't leave on your own${aid ? `, and that you use a ${aid}` : ''}. I'm finding a neighbor who is already driving out to pick you up. Please stay by the phone — I'll call you right back.`,
      es: 'Entendido. No puede salir por su cuenta. Estoy buscando un vecino que ya está saliendo para recogerle. Quédese cerca del teléfono, le llamo enseguida.',
      vi: 'Tôi hiểu rồi. Bạn không thể tự rời đi. Tôi đang tìm một người hàng xóm đang lái xe ra để đón bạn. Xin hãy ở gần điện thoại, tôi sẽ gọi lại ngay.',
      zh: '明白。你冇辦法自己離開。我而家搵緊一個正準備開車離開嘅鄰居嚟接你。請留喺電話旁邊，我好快會打返俾你。',
    })
  },

  safe: (lang: Language): Line =>
    line(lang, {
      en: 'Good. Please leave now and head west, downhill, toward Civic Center Park. Stay safe.',
      es: 'Bien. Por favor salga ahora y vaya hacia el oeste, cuesta abajo, a Civic Center Park. Cuídese.',
      vi: 'Tốt. Xin hãy rời đi ngay và đi về hướng tây, xuống dốc, đến Civic Center Park. Giữ an toàn nhé.',
      zh: '好。請即刻離開，向西落山，去Civic Center Park。注意安全。',
    }),

  helperComing: (
    first: string,
    helperFirst: string,
    vehicle: { color: string; make: string },
    etaMin: number,
    lang: Language,
  ): Line =>
    line(lang, {
      en: `Good news, ${first}. ${helperFirst}, your neighbor, is coming to get you in a ${color(vehicle.color, 'en')} ${vehicle.make}. About ${etaMin} minutes. If you can, please wait by your front door.`,
      es: `Buenas noticias, ${first}. Su vecino ${helperFirst} viene a recogerle en un ${vehicle.make} ${color(vehicle.color, 'es')}. Unos ${etaMin} minutos. Si puede, espere junto a la puerta.`,
      vi: `Tin tốt, ${first}. Hàng xóm của bạn, ${helperFirst}, đang đến đón bạn bằng xe ${vehicle.make} ${color(vehicle.color, 'vi')}. Khoảng ${etaMin} phút nữa. Nếu được, xin hãy đợi ở cửa trước.`,
      zh: `${first}，好消息。你嘅鄰居${helperFirst}揸緊一架${color(vehicle.color, 'zh')}嘅${vehicle.make}嚟接你，大約${etaMin}分鐘。如果可以，請喺門口等。`,
    }),

  escalated: (first: string, lang: Language): Line =>
    line(lang, {
      en: `${first}, I've sent your address and what you need to emergency responders. They know you're waiting. If you are in immediate danger, call 9-1-1.`,
      es: `${first}, envié su dirección y lo que necesita a los servicios de emergencia. Saben que está esperando. Si está en peligro inmediato, llame al 9-1-1.`,
      vi: `${first}, tôi đã gửi địa chỉ và nhu cầu của bạn cho lực lượng cứu hộ. Họ biết bạn đang chờ. Nếu đang gặp nguy hiểm ngay lập tức, hãy gọi 9-1-1.`,
      zh: `${first}，我已經將你嘅地址同需要通知咗緊急救援人員，佢哋知道你喺度等緊。如果你有即時危險，請打9-1-1。`,
    }),

  pickedUp: (lang: Language): Line =>
    line(lang, {
      en: "You're in the car. You'll be at Civic Center Park soon, and Red Cross volunteers will meet you there.",
      es: 'Ya está en el carro. Pronto llegará a Civic Center Park, donde le esperan voluntarios de la Cruz Roja.',
      vi: 'Bạn đã lên xe. Bạn sẽ sớm đến Civic Center Park, tình nguyện viên Hội Chữ thập đỏ sẽ đón bạn ở đó.',
      zh: '你已經上咗車，好快會到Civic Center Park，紅十字會義工會喺嗰度接你。',
    }),
}

export const SPEECH_LANG: Record<Language, string> = {
  en: 'en-US',
  es: 'es-US',
  vi: 'vi-VN',
  zh: 'zh-HK',
}
