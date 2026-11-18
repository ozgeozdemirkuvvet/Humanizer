// İstemler. Sabit kısımlar (sistem istemi) önbelleğe uygun biçimde değişmez tutulur; değişken
// içerik (öğrenci metni, kırpıntılar) kullanıcı mesajında yer alır.

import { CODES, CRITERIA, optionLetters } from '../core/codes.js';
import { rubricPromptText } from '../core/rubric.js';
import { contentPoints } from '../core/scoring.js';
import { lineLayout } from '../core/errors.js';

export const READ_SYSTEM = `You transcribe handwritten answers on English-language exam papers for a teacher in a Turkish high school. Your transcription is used for grading, so it must reflect exactly what the student wrote.

Rules:
1. Transcribe verbatim. Keep every spelling, grammar, capitalisation and punctuation mistake exactly as written. Never correct, complete or improve the student's text.
2. Do not guess. If you cannot read a word with reasonable certainty, output the text "[okunamadı]" for that word with a low confidence (below 0.5). A plausible guess is still a guess: mark it [okunamadı].
3. confidence is your calibrated probability (0–1) that the word is transcribed exactly right, including its spelling.
4. Skip words the student clearly crossed out. Do not transcribe any printed text (instructions, line numbers, labels).
5. box is the word's bounding box in that image, as [x0, y0, x1, y1] on a 0–1000 scale of the image width and height.
6. Writing and open-answer regions have printed line numbers in the left margin; use the printed number as the line number n. If a handwritten line sits between two printed lines, use the nearest line above. Short-answer regions are a single line: n = 1.
7. Judge only the language. Neat or messy handwriting must not change anything except your confidence.`;

export const READ_SYSTEM_FREEFORM = `${READ_SYSTEM}
8. This is a whole exam page in the teacher's own format. The top of the page has been blacked out for privacy. For each question listed, find the student's answer on the page:
   - Multiple choice / true-false / matching: put the chosen option letter in answers[] ("" if blank; letters separated by "," if several are marked). For true/false use "D" (doğru/true) or "Y" (yanlış/false).
   - Short answers: put the written answer in answers[], verbatim.
   - Open-ended questions and writing tasks: output a region with region_id = the question id; number the student's handwritten lines of that answer from 1 in reading order; boxes are relative to the whole page image.`;

/** Aşama A kullanıcı mesajı: her kırpıntı etiketli bir görüntü. */
export function readUserContent(exam, crops) {
  const q = new Map(exam.questions.map(x => [x.id, x]));
  const content = [];
  if (crops.length === 1 && crops[0].kind === 'page') {
    const list = exam.questions.map(x => `- question_id "${x.id}" (Q${x.no}, ${x.type}${x.type === 'mc' || x.type === 'match' ? `, options ${optionLetters(x).join('/')}` : ''})${x.text ? `: ${x.text.slice(0, 160)}` : ''}`).join('\n');
    content.push({ type: 'text', text: `Questions on this paper:\n${list}\n\nPage image:` });
    content.push(imageBlock(crops[0].jpeg));
    content.push({ type: 'text', text: 'Transcribe the answers following the rules.' });
    return content;
  }
  content.push({ type: 'text', text: `Transcribe each region below. Return one entry in regions[] per region_id. answers[] stays empty.` });
  for (const c of crops) {
    const qq = q.get(c.questionId);
    const what = c.kind === 'writing' ? `writing task Q${qq?.no}, printed lines ${c.firstLine}–${c.lastLine}`
      : c.kind === 'open' ? `open-ended answer Q${qq?.no}, printed lines ${c.firstLine}–${c.lastLine}` : `short answer Q${qq?.no}`;
    content.push({ type: 'text', text: `region_id "${c.regionId}" — ${what}` });
    content.push(imageBlock(c.jpeg));
  }
  return content;
}

function imageBlock(jpegBase64) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } };
}

/** Aşama B sistem istemi: sınav başına sabit (önbellek dostu). */
export function evalSystem(exam) {
  const lang = exam.explainLang === 'en' ? 'English' : 'Turkish';
  const codes = Object.entries(CODES).filter(([k]) => k !== 'Key').map(([k, v]) => `  ${k} = ${v.en} (${v.tr})`).join('\n');
  const crit = Object.entries(CRITERIA).map(([k, v]) => `  ${k} = ${v.en}`).join('\n');
  return `You are an English teacher with 15+ years of experience in Turkish state high schools (MEB) and an expert in language assessment. You mark exam papers with the care of an experienced teacher: fair, consistent, evidence-based and encouraging.

Class: ${exam.grade === 'hazirlik' ? 'prep class (hazırlık)' : `grade ${exam.grade}`}${exam.className ? ` (${exam.className})` : ''}. Target level: CEFR ${exam.cefr}.
Write every explanation, example context, justification and all feedback in ${lang}. ${lang === 'Turkish' ? 'Use simple, clear Turkish a teenager understands; address the student as "sen". Keep English examples and corrected forms in English.' : 'Use simple, clear English suitable for the student\'s level.'}

ERROR CODES
${codes}

RUBRIC CRITERIA (writing)
${crit}
${rubricPromptText(exam.cefr)}

HOW TO MARK WRITING
1. Mark every error. If the same kind of error occurs several times, list every occurrence as its own entry with the same rule_id, but write the rule explanation only once in rules[].
2. quote must be copied character for character from the transcribed line (it must be a substring of that line). Use the smallest span that shows the error. For a missing word (^), quote the word right before the gap and give the full corrected phrase as correction. occurrence = which occurrence of quote in that line (1 = first).
3. original = the student's full sentence; corrected = the same sentence with only this error fixed; correction = just the corrected word/phrase.
4. severity: "bozuyor" if the error makes the meaning unclear or different for a reader; otherwise "bozmuyor".
5. criterion: the rubric criterion the error affects most.
6. certain = false when you are not sure it is an error (e.g. acceptable British/American variation, informal but acceptable usage, depends on intended meaning, or the line contains [okunamadı] near it). Then explain why in uncertain_reason. Never mark [okunamadı] itself as an error.
7. suggestions: expressions that are correct but could be better at this level (richer vocabulary, a better linker, a more natural collocation). Suggestions never reduce the score. Do not repeat an error as a suggestion.
8. Rubric: give a band 0–5 for each criterion with a short justification citing concrete evidence from the text (quote or line). Calibrate strictly to the target level: a student who fully meets the ${exam.cefr} expectation gets 5. Handwriting neatness must not affect anything. Consider word count against the task.

RULE EXPLANATIONS (rules[])
- One entry per rule_id. explanation: the rule in one or two short sentences at the student's level, explaining why the form is wrong (e.g. "'yesterday' geçmiş zamanı gösterir; bu yüzden fiil 2. hâline (went) geçmelidir."). example: one NEW correct English sentence that shows the rule (not the student's sentence).
- rule_id: a short stable kebab-case id for the underlying rule (e.g. "past-simple-time-expression", "third-person-s", "article-a-an"). Use the same id for the same rule across papers.

HOW TO MARK OPEN-ENDED ANSWERS (open[])
Each open question comes with the teacher's model answer and numbered content points. Language accuracy counts for ${Number(exam.langWeight ?? 30)}% of the question score and content for the rest.
1. points[]: one entry per content point (index as given). verdict: "karsilandi" (the answer clearly expresses it, in any wording, synonyms and paraphrases count), "kismen" (partly, vague or incomplete) or "eksik" (missing or wrong). justification: one short sentence citing what the student wrote. Judge meaning, not form: a correct idea with grammar mistakes is still "karsilandi"; language is judged separately. Do not require the model answer's exact words. If the question asks for information from a text, accept any answer that is correct for that question.
2. language: band 0–4 (4 = accurate for ${exam.cefr}, at most very minor slips; 3 = a few errors, meaning clear; 2 = noticeable errors, meaning mostly clear; 1 = many errors, meaning strained; 0 = not understandable). Calibrate to ${exam.cefr}. justification: one sentence naming the main errors or strengths.
3. errors[]: mark language errors exactly as for writing (same fields, same rules). If a part of the answer is factually wrong or answers a different question, mark that span with code "Key" (content), severity "bozuyor", and give the correct content as correction.
4. If the answer is a copied sentence from the question or unrelated, all points are "eksik".
5. suggestions[]: as for writing; never reduce the score.

WRONG CLOSED-ENDED / SHORT ANSWERS (answer_notes[])
- For each wrong answer listed in the input, explain briefly why the key is correct and the student's answer is not, with a matching code (use "Key" when no language error code fits), a rule_id, a short example sentence and severity.

FEEDBACK
- strength: exactly one specific strength.
- improvements: at most 3 priority areas, most important first.
- study_tip: one concrete, doable study suggestion.
- Tone: encouraging, clear, non-judgmental. Never comment on handwriting or personality.`;
}

/**
 * Aşama B kullanıcı mesajı (yalnızca metin; görüntü yok, kişisel veri yok).
 * @param {object} exam
 * @param {object[]} regions birleştirilmiş okuma bölgeleri
 * @param {object[]} wrong yanlış/boş kapalı uçlu ve kısa cevaplar [{q, given}]
 * @param {string[]} prefs öğretmen tercihleri (düzenleme günlüğünden)
 */
export function evalUserText(exam, regions, wrong, prefs = []) {
  const parts = [];
  if (prefs.length) parts.push(`<teacher_preferences>\nThe teacher corrected earlier markings on this exam. Follow these decisions:\n${prefs.map(p => `- ${p}`).join('\n')}\n</teacher_preferences>`);
  const textOf = q => (regions.find(r => r.questionId === q.id)?.lines || []).map(l => `${l.n}: ${lineLayout(l.words).text}`).join('\n');
  for (const q of exam.questions.filter(x => x.type === 'open')) {
    const kp = contentPoints(q);
    parts.push(`<open question_id="${q.id}" no="${q.no}" points="${q.points}">
<question>${q.text || ''}</question>
${q.modelAnswer ? `<model_answer>${q.modelAnswer}</model_answer>\n` : ''}<content_points>
${kp.map((k, i) => `${i}: ${k}${!(q.keyPoints || []).length ? ' (compare with the model answer)' : ''}`).join('\n')}
</content_points>
<student_answer>
${textOf(q) || '(empty)'}
</student_answer>
</open>`);
  }
  for (const q of exam.questions.filter(x => x.type === 'writing')) {
    const reg = regions.find(r => r.questionId === q.id);
    const lines = (reg?.lines || []).map(l => `${l.n}: ${lineLayout(l.words).text}`).join('\n');
    parts.push(`<writing question_id="${q.id}" no="${q.no}" points="${q.points}"${q.minWords ? ` min_words="${q.minWords}"` : ''}${q.maxWords ? ` max_words="${q.maxWords}"` : ''}>
<task>${q.text || '(task text not provided by the teacher)'}</task>
<student_text>
${lines || '(empty)'}
</student_text>
</writing>`);
  }
  if (wrong.length) {
    parts.push(`<wrong_answers>\n${wrong.map(w => `- question_id "${w.q.id}" (Q${w.q.no}, ${w.q.type})${w.q.text ? ` "${w.q.text}"` : ''}: student answered "${w.given}", key "${(w.q.key || []).join(' / ')}"${w.q.alternatives?.length ? ` (also accepted: ${w.q.alternatives.join(', ')})` : ''}`).join('\n')}\n</wrong_answers>`);
  }
  parts.push('Mark this paper. Return open[] for every open question above, writing[] for every writing question above, rules[] for every rule_id you use, answer_notes[] for every wrong answer listed, and the feedback.');
  return parts.join('\n\n');
}

/** Öğretmen düzenlemelerinden kısa tercih cümleleri (son 30, tekrarsız). */
export function teacherPreferences(edits) {
  const out = [];
  for (const e of [...edits].reverse()) {
    let s = '';
    if (e.kind === 'error.delete' && e.before) s = `Do not mark "${e.before.quote}" as ${e.before.code} (${e.before.ruleId || 'rule'}); the teacher removed this marking${e.note ? `: ${e.note}` : ''}.`;
    else if (e.kind === 'error.edit' && e.before && e.after) s = `For "${e.before.quote}", the teacher changed ${diffText(e.before, e.after)}.`;
    else if (e.kind === 'error.add' && e.after) s = `The teacher added a missed error: "${e.after.quote}" → "${e.after.correction}" (${e.after.code}). Watch for similar errors.`;
    else if (e.kind === 'band.edit' && e.before && e.after) s = `The teacher changed ${e.after.criterion === 'DIL' ? 'the open-answer language band' : e.after.criterion} from band ${e.before.band} to ${e.after.band}${e.note ? ` (${e.note})` : ''}; calibrate similar texts accordingly.`;
    else if (e.kind === 'point.edit' && e.before && e.after) s = `For the content point "${e.after.point}", the teacher changed the verdict from "${e.before.verdict}" to "${e.after.verdict}"; judge similar answers the same way.`;
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 30) break;
  }
  return out;
}

function diffText(a, b) {
  const keys = ['code', 'severity', 'correction', 'certain'].filter(k => a[k] !== b[k]);
  return keys.map(k => `${k} from "${a[k]}" to "${b[k]}"`).join(', ') || 'the explanation';
}

