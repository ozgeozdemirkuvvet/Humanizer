# Değişiklik günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esas alınarak tutulur.

## [1.1.0] - 2026-11-18
### Eklendi
- "Örnek metinle dene" düğmesi (TR/EN). Analiz, API anahtarı olmadan denenebilir.
- Yazarken canlı analiz ve klavye kısayolları: `Ctrl/⌘+Enter`, `Ctrl/⌘+Shift+Enter`, `Esc`.
- WAI-ARIA sekme deseni (ok tuşlarıyla gezinme), görünür odak halkası, `prefers-reduced-motion` desteği.
- PWA: yüklenebilir uygulama ve çevrimdışı çalışma (service worker).
- Erişilebilirlik (axe-core, WCAG 2.1 AA), performans ve klavye testleri; ESLint; Dependabot.
- Mimari belgesi, katkı rehberi, güvenlik politikası, issue ve PR şablonları, demo GIF.

### Değişti
- Proje MIT lisansıyla yayımlandı.
- Vurgulama tarama çizgisi algoritmasına geçti: 20.000 kelimede analiz ve çizim 406 ms'den 261 ms'ye indi.

### Düzeltildi
- Markdown temizliğinde `**kalın**` yerine `$1` yazılması.
- Görünmez karakter etiketlerindeki renk kontrastı (WCAG AA).

## [1.0.0] - 2026-11-18
### Eklendi
- Kişisel üslup profili, yapay zekâ izi analizi (6 kategori), Claude ile yeniden yazma.
- Kelime düzeyinde diff, değişiklik bazında kabul/ret, skor karşılaştırması, anlam kontrolü.
- Görünmez karakter ve markdown temizliği, `.docx` meta veri temizliği.
- TR/EN arayüz, açık/koyu tema, son 10 metin geçmişi, `.txt` ve `.docx` dışa aktarma.
