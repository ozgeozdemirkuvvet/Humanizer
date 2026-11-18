# Güvenlik politikası

## Tehdit modeli

Doğal Kalem tamamen tarayıcıda çalışan, sunucusu olmayan bir uygulamadır.

| Varlık | Nerede durur | Nereye gider |
|---|---|---|
| Metinler, profil, geçmiş | `localStorage` (yalnızca bu tarayıcı) | Hiçbir yere |
| Yeniden yazılacak metin | Bellek | Yalnızca kullanıcı "Yeniden yaz" dediğinde `api.anthropic.com` |
| Anthropic API anahtarı | `localStorage` | Yalnızca `api.anthropic.com` |
| `.docx` dosyaları | Bellek | Hiçbir yere (işlem tarayıcıda) |

**Bilinen sınırlama:** API anahtarı tarayıcıda saklandığı için, cihaza ya da tarayıcı profiline erişimi olan biri anahtarı okuyabilir. Uygulamayı ortak bilgisayarlarda kullanmayın. Gerekirse [Anthropic Console](https://console.anthropic.com/) üzerinden harcama limiti olan ayrı bir anahtar oluşturun.

## Açık bildirme

Bir güvenlik açığı bulursanız lütfen herkese açık issue açmayın. GitHub'ın **Security → Report a vulnerability** özelliğiyle özel olarak bildirin.
