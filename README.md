# DAD Prestij Bungalov: rezervasyon sitesi

Müşteri rezervasyon talebi gönderdiğinde:

1. Seçtiği günler takvimde hemen kapanır, yeni gelen müşteri dolu günleri görür.
2. Sunucu, WhatsApp'tan **0 501 618 65 92** numarasına kendisi mesaj atar. Mesajda bungalov numarası, giriş ve çıkış günleri, kişi sayısı, ad ve telefon yazar.
3. Yönetim bölümünden talebi onaylar veya iptal edersiniz. İptal edilen günler hemen açılır.

Müşterinin hiçbir şeye basması gerekmez.

## 1. WhatsApp bildirimini açın (bir kerelik, ücretsiz)

Bildirimler CallMeBot servisiyle gider. Numaranız için anahtar almanız gerekir:

1. https://www.callmebot.com/blog/free-api-whatsapp-messages/ sayfasını açın.
2. Sayfadaki adımları **bildirimin geleceği telefondan** uygulayın: CallMeBot'un numarasını rehbere ekleyip ona sayfada yazılan onay cümlesini WhatsApp'tan gönderirsiniz.
3. Birkaç dakika içinde size bir **API anahtarı** mesajla gelir.
4. Bu anahtarı `.env` dosyasındaki `CALLMEBOT_APIKEY=` satırına yazın.

Not: CallMeBot ücretsiz ve üçüncü taraf bir servistir, garanti vermez. İş büyürse Meta'nın resmi WhatsApp Business API'sine geçilebilir. `server.js` içindeki `bildir` fonksiyonu tek yerden değişir.

## 2. Kurulum

Bilgisayara veya sunucuya **Node.js 18 ya da daha yenisi** kurulu olmalı. Başka paket gerekmez.

```
cp .env.example .env      # sonra .env dosyasını açıp doldurun
node server.js
```

Site `http://localhost:3000` adresinde açılır.

`.env` içinde şunları ayarlayın:

| Ayar | Anlamı |
| --- | --- |
| `ADMIN_PASSWORD` | Yönetim şifresi, en az 8 karakter |
| `BILDIRIM_TELEFON` | Bildirimin gideceği numara, başında 0 olmadan: `905016186592` |
| `CALLMEBOT_APIKEY` | Yukarıda aldığınız anahtar |
| `BUNGALOV_SAYISI` | Bungalov sayısı (varsayılan 3) |
| `MAX_KISI` | Bir bungalovda en fazla kişi (varsayılan 4) |
| `GECELIK_FIYAT` | Gecelik fiyat, toplam tutar hesabı ve WhatsApp mesajı için (varsayılan 9000) |

Fiyatı değiştirirseniz `public/index.html` içindeki `GECELIK=9000` satırını ve sayfadaki "9.000 ₺" yazılarını da güncelleyin.

## 3. İnternete açma

Müşterilerin görmesi için sunucuyu bir yerde sürekli çalıştırmak gerekir. Render, Railway, Fly.io gibi servisler ya da bir VPS olur. Başlatma komutu `node server.js`.

Dikkat: Kayıtlar `data/rezervasyonlar.json` dosyasında durur. Bazı ücretsiz servislerde disk her yeniden başlatmada silinir. Kalıcı disk bağlayın ve yolunu `DATA_DIR` ile belirtin.

## 4. Yönetim

Sitenin altındaki **Yönetim** bağlantısına tıklayın (veya adresin sonuna `#yonetim` ekleyin), şifrenizi yazın. Orada:

- Gelen talepleri bungalov numarasıyla görürsünüz.
- **Onayla** ve **İptal et** düğmeleri vardır.
- Telefonla aldığınız rezervasyonları veya bakım günlerini **Günleri kapat** ile elle kapatırsınız.

## Dosyalar

- `server.js`: sunucu, kayıt, çakışma kontrolü, WhatsApp bildirimi
- `public/index.html`: site
- `public/img/`: düzenlenmiş fotoğraflar
- `data/`: rezervasyon kayıtları (otomatik oluşur)
