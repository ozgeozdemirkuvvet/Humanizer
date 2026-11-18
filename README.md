# Doğal Kalem

Yapay zekâyla üretilmiş ya da desteklenmiş Türkçe ve İngilizce metinleri, anlamı bozmadan sizin üslubunuzla yeniden yazan tek sayfalık web uygulaması. Uygulamanın tamamı `index.html` dosyasında.

## Kullanım
1. `index.html` dosyasını tarayıcıda açın. Sunucu ya da kurulum gerekmez (GitHub Pages ile de yayınlanabilir).
2. **Üslup profili:** Kendi yazdığınız 3–5 metni yapıştırıp "Profili çıkar ve kaydet" düğmesine basın.
3. **Analiz:** Metni yapıştırıp "Analiz et" düğmesine basın. Bu adım çevrimdışı çalışır ve API gerektirmez.
4. **Yeniden yaz:** Ayarlar'a Anthropic API anahtarınızı girin, ton ve yoğunluğu seçin.
5. **Karşılaştır:** Her değişikliği tek tek kabul edin ya da reddedin. Ardından sonucu kopyalayın ya da .txt/.docx olarak indirin.

## Gizlilik
- Profil, örnek metinler, geçmiş (son 10 metin) ve API anahtarı yalnızca tarayıcının `localStorage` alanında tutulur.
- Metin yalnızca "Yeniden yaz" ve "Yapay zekâ ile derin anlam kontrolü" düğmelerine basıldığında `api.anthropic.com` adresine gönderilir.
- .docx temizliği tamamen tarayıcıda yapılır.

## Notlar
- Analiz puanları sezgiseldir (heuristik). Bunlar bir "yapay zekâ dedektörü" sonucu değil, metni düzeltmek için bir kontrol listesidir.
- API anahtarı tarayıcıda durduğu için uygulamayı ortak bilgisayarlarda kullanmayın.
