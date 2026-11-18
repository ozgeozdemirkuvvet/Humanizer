// Gerçek bir okuma sınavının 2. sayfası (Task 4–6) ve öğretmenin kırmızı kalemle puanladığı 5 kağıt.
// Kimlik yok: kağıtlar A–E diye adlandırıldı; görüntüler depoya konmadı, yalnızca cevapların
// okunmuş metni ve öğretmenin verdiği puanlar var. Okumalar insan gözüyle yapıldı (Claude
// tarafından, fotoğraflardan); belirsiz kalan yerler `uncertain` ile işaretli.

export const exam = {
  id: 'okuma-2', name: 'Reading 2 – Can Starting School Later Reduce School Anxiety?', grade: '11', cefr: 'B1',
  explainLang: 'tr', spelling: 'esnek', sheetMode: 'serbest', redactTop: 0.15, pagesPerStudent: 2, langWeight: 0,
  readingText: '', // asıl metin öğretmenin sınav kağıdında; değerlendirmede buraya yapıştırılır
  markingNotes: 'Dilbilgisi ve yazım hataları puan kırmaz; yalnızca içerik puanlanır. Metinden aynen alınan cevaplar kabul. Yalnızca anahtar kelime (ör. "Melatonin.") yarım puan. Belirsiz cevap ("because of their body clock") puan almaz.',
  questions: [
    { id: 't4-1', no: 1, type: 'gap', points: 1, prefix: 'c', key: ['curriculum'], alternatives: [] },
    { id: 't4-2', no: 2, type: 'gap', points: 1, prefix: 'e', key: ['extensively'], alternatives: [] },
    { id: 't4-3', no: 3, type: 'gap', points: 1, prefix: 'a', key: ['anxiety'], alternatives: ['academic pressure'] },
    { id: 't4-4', no: 4, type: 'gap', points: 1, prefix: 'f', key: ['flexible'], alternatives: [] },
    { id: 't4-5', no: 5, type: 'gap', points: 1, prefix: 'c', key: ['collaborate'], alternatives: [] },
    { id: 't4-6', no: 6, type: 'gap', points: 1, prefix: 's', key: ['schedule'], alternatives: ['school schedule'] },
    { id: 't5', no: 7, type: 'open', points: 2, lines: 2, text: "What was the writer's main purpose in writing this article?",
      modelAnswer: 'To persuade schools to consider later starting times to reduce anxiety and improve learning.', keyPoints: [] },
    { id: 't6-1', no: 8, type: 'open', points: 1, lines: 1, text: "How do some adults interpret teenagers' emotional reactions?",
      modelAnswer: 'They may see them as lazy, selfish or unwilling to follow a normal school schedule.', keyPoints: [] },
    { id: 't6-2', no: 9, type: 'open', points: 1, lines: 1, text: 'According to scientific research, why do teenagers experience strong emotions and have difficulty dealing with stress?',
      modelAnswer: 'During adolescence the brain undergoes complex development that affects emotions and the ability to manage stress.', keyPoints: [] },
    { id: 't6-3', no: 10, type: 'open', points: 1, lines: 1, text: 'What biological change explains why teenagers naturally prefer going to bed and waking up later?',
      modelAnswer: 'The teenage brain releases melatonin later in the evening, which shifts their body clock.', keyPoints: [] },
    { id: 't6-4', no: 11, type: 'open', points: 1, lines: 1, text: 'What two academic demands can make school-related anxiety worse for sleep-deprived students?',
      modelAnswer: 'Any two of: a demanding curriculum, frequent examinations, endless lists of tasks, high academic expectations.', keyPoints: [] },
    { id: 't6-5', no: 12, type: 'open', points: 1, lines: 1, text: 'What two concerns might students have when they struggle to stay awake during lessons?',
      modelAnswer: 'Any two of: falling behind, making mistakes, performing poorly in examinations.', keyPoints: [] },
    { id: 't6-6', no: 13, type: 'open', points: 1, lines: 2, text: "How could a later school starting time positively affect students' learning and emotional health?",
      modelAnswer: 'They could get enough rest, which boosts concentration, emotional health and academic performance.', keyPoints: [] }
  ]
};

/** answers: soru id → okunan metin; teacher: öğretmenin verdiği puan (aynı id). teacherTotals: kağıtta daire içindeki toplamlar. */
export const papers = [
  { label: 'A',
    answers: { 't4-1': 'hanges', 't4-2': 'motional', 't4-3': 'cademic pressure', 't4-4': 'lexible', 't4-5': 'ollaborate', 't4-6': 'truggle',
      t5: 'Students and adult are not in same class Teenagers we need to know differentie to making decesion',
      't6-1': 'They think children lying', 't6-2': 'because of parents and the hardness of exam', 't6-3': 'because of their body clock', 't6-4': '', 't6-5': '', 't6-6': '' },
    teacher: { 't4-1': 0, 't4-2': 0, 't4-3': 1, 't4-4': 1, 't4-5': 1, 't4-6': 0, t5: 0, 't6-1': 0, 't6-2': 0, 't6-3': 0, 't6-4': 0, 't6-5': 0, 't6-6': 0 },
    teacherTotals: { task4: 3, task5: 0, task6: 0 } },
  { label: 'B',
    answers: { 't4-1': 'lassrooms', 't4-2': 'ffectively', 't4-3': 'nxiyty', 't4-4': 'lexible', 't4-5': 'ollaborate', 't4-6': 'chool schedule',
      t5: "To tell us that schools should change their schedule to match their students'",
      't6-1': 'They consider them lazy, selfish or unwilling to follow a normal school schedule.',
      't6-2': 'During adolescence, the brain undergoes complex development that affects emotions and the ability to manage stressful situations.',
      't6-3': 'Melatonin.', 't6-4': 'Demanding curriculum and frequent examinations.', 't6-5': 'Falling behind and performing poorly in examinations.',
      't6-6': 'Students could get enough sleep which would make them less sleepy and more concentrated in classrooms. They would get less anxiety and feel more relaxed in exams.' },
    teacher: { 't4-1': 0, 't4-2': 0, 't4-3': 1, 't4-4': 1, 't4-5': 1, 't4-6': 1, t5: 2, 't6-1': 1, 't6-2': 1, 't6-3': 0.5, 't6-4': 1, 't6-5': 1, 't6-6': 1 },
    teacherTotals: { task4: 4, task5: 2, task6: 5.5 } },
  { label: 'C',
    answers: { 't4-1': 'hallenges', 't4-2': 'xtensively', 't4-3': 'nxiety', 't4-4': 'requent', 't4-5': 'ollaborate', 't4-6': 'chedule',
      t5: 'Teenagers have different needs for their mental health and academic achievement. Because of that schools may consider to change their schedules.',
      't6-1': 'Consider them lazy, selfish, or unwilling to follow a normal school schedule',
      't6-2': 'Teenagers brain releases melatonin. That melatonin affect their sleeping period.',
      't6-3': 'Because their brain releases melatonin later in the evening than an adult brain.',
      't6-4': '', 't6-5': 'Falling behind, making mistakes.', 't6-6': 'They can get enough rest, boosting their concentration, emotional health and academic performance' },
    // Task 6 toplamı 3,5. S1, S5, S6 tam, S4 boş → S2 + S3 = 0,5. Hangi soruya yarım verildiği kağıttan net okunamadı.
    teacher: { 't4-1': 0, 't4-2': 1, 't4-3': 1, 't4-4': 0, 't4-5': 1, 't4-6': 1, t5: 2, 't6-1': 1, 't6-2': 0, 't6-3': 0.5, 't6-4': 0, 't6-5': 1, 't6-6': 1 },
    uncertain: { 't6-2': 'S2 ile S3 arasındaki 0,5 dağılımı belirsiz', 't6-3': 'Aynı cevap D kağıdında tam puan almış' },
    teacherTotals: { task4: 4, task5: 2, task6: 3.5 } },
  { label: 'D',
    answers: { 't4-1': 'urriculum', 't4-2': 'xtensively', 't4-3': 'nxiety', 't4-4': 'lexible', 't4-5': 'ollaborate', 't4-6': 'chedule',
      t5: "To change people's prejudice about teenagers' long sleeping hours and tell them there is a scientific reason behind this.",
      't6-1': 'They consider them lazy, selfish or unwilling to follow a normal school schedule.',
      't6-2': 'Because the brain undergoes complex development that affects emotions and ability to manage stressful situations.',
      't6-3': 'Their brain releases melatonin later in the evening than an adult brain.',
      't6-4': 'Demanding curriculum and frequent examinations can make school related anxiety worse for sleep-deprived students.',
      't6-5': 'They worry about making mistakes and falling behind.',
      't6-6': 'It could allow teenagers to get enough rest, improve their concentration, academic success and emotional health.' },
    teacher: { 't4-1': 1, 't4-2': 1, 't4-3': 1, 't4-4': 1, 't4-5': 1, 't4-6': 1, t5: 1, 't6-1': 1, 't6-2': 1, 't6-3': 1, 't6-4': 1, 't6-5': 1, 't6-6': 1 },
    teacherTotals: { task4: 6, task5: 1, task6: 6 } },
  { label: 'E',
    answers: { 't4-1': 'onditions', 't4-2': 'specially', 't4-3': 'cademic pressure', 't4-4': 'lexible', 't4-5': 'oncentrate', 't4-6': 'chedule',
      t5: 'Explaining what teenagers go through during adolescence.',
      't6-1': 'Lazy and selfish, unwilling', 't6-2': 'Because during adolescence, the brain undergoes complex development that affects emotions.',
      't6-3': 'Teenage brain releases melatonin which shifts their body clock.', 't6-4': 'Frequent examinations, endless lists of tasks,',
      't6-5': 'Falling behind and making mistakes.', 't6-6': "It can improve students' well being and learning." },
    // Task 4 için kağıtta "4" yazıyor; cevap anahtarına göre doğru sayısı 3 (onditions, specially, oncentrate yanlış).
    teacher: { 't4-1': 0, 't4-2': 0, 't4-3': 1, 't4-4': 1, 't4-5': 0, 't4-6': 1, t5: 1, 't6-1': 0.5, 't6-2': 1, 't6-3': 1, 't6-4': 1, 't6-5': 1, 't6-6': 1 },
    uncertain: { task4: 'Daire içindeki toplam 4, maddelere göre 3' },
    teacherTotals: { task4: 4, task5: 1, task6: 5.5 } }
];
