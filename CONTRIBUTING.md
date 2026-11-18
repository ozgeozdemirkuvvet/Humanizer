# Katkı rehberi

Katkılarınız için teşekkürler!

## Geliştirme ortamı

```bash
npm install
npx playwright install chromium
npm run check      # lint + tüm testler
npm start          # http://localhost:8080
```

## İlkeler

- **Tek dosya kuralı:** Uygulama `index.html` içinde kalır. Yeni bir çalışma zamanı bağımlılığı gerekiyorsa, sabit sürümle ve yalnızca kullanıldığı anda yüklenmelidir.
- **Analiz yerel kalır:** Analiz modülü ağ isteği yapmaz.
- **Türkçe öncelikli:** Yeni ifade kalıplarında `phraseRe()` kullanın (İ/ı ve ek desteği için).
- **Klişe listesine ekleme:** `CLICHES` içine `{ p: 'ifade~', s: 'doğal öneri' }` ekleyin. `~`, Türkçe ekleri kabul eder. Ardından `tests/app.test.cjs` içine bir örnek ekleyin.
- **Erişilebilirlik:** Her arayüz değişikliğinden sonra `npm test` axe-core denetimini de çalıştırır; WCAG 2.1 AA ihlali bırakmayın.
- **İki dil:** Arayüz metinleri hem `I18N.en`/`DYN.en` hem de Türkçe karşılıklarıyla eklenir.

## Commit ve PR

- Küçük, tek amaçlı commit'ler tercih edilir.
- PR açmadan önce `npm run check` yeşil olmalıdır.
- Arayüz değişikliklerinde PR açıklamasına ekran görüntüsü ekleyin.
