# Geri bildirim

Doğal Kalem'i kullandığınız ve fikirlerinizi paylaştığınız için teşekkürler!

Bu proje **tüm hakları saklı** bir projedir (bkz. [LICENSE](LICENSE)). Bu yüzden dışarıdan kod katkısı (pull request) kabul edilmez. Ancak geri bildirimleriniz çok değerli:

- **Hata bildirimi:** [Issues](../../issues/new/choose) → *Hata bildirimi*
- **Özellik ya da yeni klişe önerisi:** [Issues](../../issues/new/choose) → *Özellik önerisi*
- **Güvenlik açığı:** Herkese açık issue açmayın; [SECURITY.md](SECURITY.md) içindeki yolu izleyin.

Lütfen bildirimlerinizde API anahtarınızı ya da kişisel metinlerinizi paylaşmayın.

## Proje sahibi için geliştirme notları

```bash
npm install
npx playwright install chromium
npm run check      # lint + tüm testler
npm start          # http://localhost:8080
```

- `main` dalı korumalıdır: değişiklikler ayrı bir dalda yapılır ve CI yeşil olduktan sonra pull request ile birleştirilir.
- Uygulama `index.html` içinde kalır. Yeni bir çalışma zamanı bağımlılığı gerekiyorsa sabit sürümle ve yalnızca kullanıldığı anda yüklenir.
- Analiz modülü ağ isteği yapmaz. Yeni ifade kalıplarında `phraseRe()` kullanılır (İ/ı ve ek desteği için).
- Arayüz metinleri hem Türkçe hem İngilizce eklenir; erişilebilirlik testi (axe-core, WCAG 2.1 AA) yeşil kalmalıdır.
