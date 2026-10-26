// Shared by the side panel and the background worker (which serves the
// in-page buttons on Facebook).

export const TONES = {
  friendly: 'Friendly and warm, like a real person who appreciates the comment.',
  professional: 'Professional, polite and concise, suitable for a business page.',
  casual: 'Casual and relaxed, like chatting with a friend.',
  witty: 'Light and witty, with gentle humour, never sarcastic or mean.',
  grateful: 'Very appreciative and humble, focused on thanking the person.',
  formal: 'Formal and respectful.',
  supportive: 'Supportive and encouraging. Show empathy, agree where you can, and make the person feel heard.',
  different: 'Offer a different perspective. Respectfully add an angle or counterpoint the commenter may not have considered.',
  angry: 'Angry and firm. Show clear frustration or disagreement in strong, direct words, but no slurs, threats or personal insults.',
  savage: 'Savage. A sharp, cutting, clever comeback that wins the exchange, roast-style, but no slurs, threats or hate.',
  sarcasm: 'Sarcastic. Dry, ironic humour that says the opposite of what is meant, so the point lands with a smirk.',
  inspiring: 'Inspiring and uplifting. Motivate the reader with hope, conviction and a memorable line.',
  thoughtful: 'Thoughtful and reflective. Engage with the idea seriously, add insight, and ask or answer with nuance.',
};
// Tones where a rude comment may get an edgy answer instead of a calm one.
const EDGY = new Set(['angry', 'savage', 'sarcasm', 'different']);
export const LENGTHS = {
  auto: 'No fixed length. Fit the reply to the comment: a quick reaction gets a quick reply, a detailed comment or question gets a full answer.',
  short: 'Keep it short, about one sentence.',
  medium: 'Two or three sentences.',
  long: 'A short paragraph (up to 5 sentences).',
};
export const DEFAULT_SNIPPETS = [
  { title: 'Thanks', text: 'Thank you so much, {name}! 🙏' },
  { title: 'ধন্যবাদ', text: 'অনেক ধন্যবাদ {name}! ❤️' },
  { title: 'Check inbox', text: 'Thanks {name}! Please check your inbox, I have sent you the details.' },
  { title: 'ইনবক্স', text: '{name}, আপনার ইনবক্স চেক করুন প্লিজ। বিস্তারিত পাঠিয়েছি।' },
];
export const DEFAULTS = {
  apiKey: '', model: 'google/gemini-2.5-flash', tone: 'friendly', replyLength: 'auto',
  myName: '', extra: '', snippets: DEFAULT_SNIPPETS,
  optExpand: true, optReplies: true, optSkipMine: true, inPageToolbar: true,
};

export async function callOpenRouter(messages, { apiKey, model }) {
  if (!apiKey) throw new Error('Add your OpenRouter API key in Settings first.');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/fb-reply-drafter',
      'X-Title': 'FB Comment Reply Drafter',
    },
    body: JSON.stringify({ model, messages, temperature: 0.8 }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.message || r.statusText;
    if (r.status === 401) throw new Error('OpenRouter rejected the API key (401). Check it in Settings.');
    if (r.status === 402) throw new Error('OpenRouter says your credits are used up (402).');
    if (r.status === 429) throw new Error('Rate limited by OpenRouter (429). Wait a moment and retry.');
    throw new Error(`OpenRouter error ${r.status}: ${msg}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty reply. Try again or pick another model.');
  return text.trim().replace(/^["“](.*)["”]$/s, '$1').trim();
}

export function languageHint(text) {
  const bn = (text.match(/[ঀ-৿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (bn && bn >= latin) return 'The comment is written in Bangla (Bengali script). Reply in Bangla script.';
  if (bn && latin) return 'The comment mixes Bangla and English. Mirror that mix.';
  return 'If the comment is English, reply in English. If it is Bangla written in Latin letters (Banglish, e.g. "vai onek sundor hoise"), reply in Banglish the same way. Otherwise reply in the comment\'s language.';
}

export function buildMessages(settings, postText, c) {
  const sys = [
    `You write replies on behalf of ${settings.myName || 'the author of a Facebook post'} to comments on their post.`,
    'Write exactly one reply to the comment you are given.',
    'Language: always reply in the same language and script as the comment.',
    `Tone: ${TONES[settings.tone] || TONES.friendly}`,
    `Length: ${LENGTHS[settings.replyLength] || LENGTHS.auto}`,
    'Sound like a real person, not a brand bot. Do not use hashtags. Do not wrap the reply in quotes. Output only the reply text.',
    'You may address the commenter by first name when it feels natural.',
    'Do not invent facts, prices, dates or promises. If the comment asks something you cannot know from the post, answer graciously and invite them to message.',
    EDGY.has(settings.tone)
      ? 'Stay within the chosen tone even if the comment is rude. Never use slurs, threats, sexual content or attacks on religion, ethnicity, gender or other protected traits.'
      : 'If the comment is rude or spam, write a calm, brief, polite reply.',
    settings.extra ? 'Extra instructions from the user: ' + settings.extra : '',
  ].filter(Boolean).join('\n');

  const user = [
    postText ? `Post:\n"""${postText}"""` : '',
    c.isReply && c.parentAuthor ? `This is a reply in a thread under ${c.parentAuthor}'s comment.` : '',
    `Comment by ${c.author}:\n"""${c.text}"""`,
    languageHint(c.text),
  ].filter(Boolean).join('\n\n');

  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

