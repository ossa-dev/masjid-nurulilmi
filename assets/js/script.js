/* ==========================================================================
   Masjid Jami' Nurul Ilmi - Script
   - Splash screen singkat (sekali per sesi)
   - Jadwal sholat otomatis (Aladhan API, metode Kemenag RI)
   - Kartu "sholat berikutnya" dengan 4 fase:
       adzan   -> hitung mundur ke adzan
       iqamah  -> hitung mundur ke iqamah (sesuai IQAMAH)
       jamaah  -> sholat berjamaah sedang berlangsung
       jumat   -> khusus Jumat (tanpa hitung mundur iqamah)
   - Bagikan halaman, salin nomor rekening, fallback gambar
   ========================================================================== */
(function () {
    'use strict';

    // ---------- Konfigurasi ----------
    var LOKASI = { lat: -7.021122, lng: 110.388571, tz: 'Asia/Jakarta' };
    var URUTAN = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    var NAMA = { Fajr: 'Subuh', Dhuhr: 'Dzuhur', Asr: 'Ashar', Maghrib: 'Maghrib', Isha: 'Isya' };

    // Jeda adzan ke iqamah (menit) sesuai ketentuan masjid
    var IQAMAH = { Fajr: 15, Dhuhr: 10, Asr: 10, Maghrib: 10, Isha: 10 };

    var DURASI_JAMAAH = 15 * 60;   // detik: lama status "sholat berjamaah sedang berlangsung"
    var DURASI_JUMAT = 60 * 60;    // detik: lama status Jumat setelah waktu Dzuhur masuk
    var AMBANG_DETIK = 5 * 60;     // di bawah ini, hitung mundur tampil dalam mm:ss
    var DURASI_SPLASH = 1500;      // milidetik
    var CACHE_PREFIX = 'jadwal-sholat:';

    var jadwal = null;        // { Fajr: menit, ..., Sunrise: menit }
    var kunciHari = '';       // yyyy-mm-dd (WIB) untuk jadwal yang sedang dipakai
    var tanggalTampil = '';   // agar teks tanggal tidak dihitung ulang tiap detik
    var timerId = null;
    var sedangMemuat = false;

    // ---------- Utilitas ----------
    function pad(n) { return String(n).padStart(2, '0'); }
    function el(id) { return document.getElementById(id); }

    function formatJam(menit) {
        var m = ((menit % 1440) + 1440) % 1440;
        return pad(Math.floor(m / 60)) + '.' + pad(m % 60);
    }

    // mm:ss untuk hitung mundur pendek
    function mmss(detik) {
        return pad(Math.floor(detik / 60)) + ':' + pad(detik % 60);
    }

    // "2 jam 18 menit" untuk hitung mundur panjang (dibulatkan ke atas)
    function jamMenit(detik) {
        var menit = Math.ceil(detik / 60);
        var jam = Math.floor(menit / 60);
        var sisa = menit % 60;
        if (jam === 0) return sisa + ' menit';
        return jam + ' jam' + (sisa ? ' ' + sisa + ' menit' : '');
    }

    // Waktu saat ini di zona WIB, terlepas dari zona waktu perangkat
    function sekarangWIB() {
        var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: LOKASI.tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            weekday: 'long', hourCycle: 'h23'
        }).formatToParts(new Date());
        var o = {};
        parts.forEach(function (p) { o[p.type] = p.value; });
        return {
            y: o.year, m: o.month, d: o.day, weekday: o.weekday,
            detik: (+o.hour) * 3600 + (+o.minute) * 60 + (+o.second)
        };
    }

    function tanggalPanjang() {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: LOKASI.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }).format(new Date());
    }

    function keMenit(teks) {
        var m = String(teks).match(/(\d{1,2}):(\d{2})/);
        return m ? (+m[1]) * 60 + (+m[2]) : null;
    }

    function namaTampil(kunci, weekday) {
        return (kunci === 'Dhuhr' && weekday === 'Friday') ? 'Dzuhur (Jumat)' : NAMA[kunci];
    }

    // ---------- Toast ----------
    var toastTimer = null;
    function toast(pesan) {
        var t = el('toastNote');
        if (!t) return;
        t.textContent = pesan;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    }

    // ---------- Ambil jadwal ----------
    function bersihkanCacheLama(kunciAktif) {
        try {
            Object.keys(localStorage).forEach(function (k) {
                if (k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_PREFIX + kunciAktif) {
                    localStorage.removeItem(k);
                }
            });
        } catch (e) { /* abaikan: penyimpanan tidak tersedia */ }
    }

    function ambilJadwal(p) {
        var kunci = p.y + '-' + p.m + '-' + p.d;

        try {
            var cache = localStorage.getItem(CACHE_PREFIX + kunci);
            if (cache) return Promise.resolve({ kunci: kunci, data: JSON.parse(cache) });
        } catch (e) { /* lanjut ke jaringan */ }

        var url = 'https://api.aladhan.com/v1/timings/' + p.d + '-' + p.m + '-' + p.y +
            '?latitude=' + LOKASI.lat + '&longitude=' + LOKASI.lng +
            '&method=20&timezonestring=' + encodeURIComponent(LOKASI.tz);

        return fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (json) {
                var t = json && json.data && json.data.timings;
                if (!t) throw new Error('Format data tidak dikenali');
                var hasil = {};
                URUTAN.concat(['Sunrise']).forEach(function (k) {
                    var menit = keMenit(t[k]);
                    if (menit === null) throw new Error('Waktu ' + k + ' tidak valid');
                    hasil[k] = menit;
                });
                try {
                    localStorage.setItem(CACHE_PREFIX + kunci, JSON.stringify(hasil));
                    bersihkanCacheLama(kunci);
                } catch (e) { /* abaikan */ }
                return { kunci: kunci, data: hasil };
            });
    }

    // ---------- Logika fase ----------
    // Sholat berikutnya yang adzannya belum masuk. Setelah Isya -> Subuh besok.
    function cariBerikut(detik) {
        for (var i = 0; i < URUTAN.length; i++) {
            var k = URUTAN[i];
            if (jadwal[k] * 60 > detik) return { k: k, besok: false, target: jadwal[k] * 60 };
        }
        return { k: 'Fajr', besok: true, target: jadwal.Fajr * 60 + 86400 };
    }

    function tentukanFase(now) {
        var jumat = now.weekday === 'Friday';

        for (var i = 0; i < URUTAN.length; i++) {
            var k = URUTAN[i];
            var adzan = jadwal[k] * 60;

            if (k === 'Dhuhr' && jumat) {
                if (now.detik >= adzan && now.detik < adzan + DURASI_JUMAT) {
                    return { fase: 'jumat', k: k };
                }
                continue;
            }

            var iqamah = adzan + IQAMAH[k] * 60;
            if (now.detik >= adzan && now.detik < iqamah) {
                return { fase: 'iqamah', k: k, target: iqamah };
            }
            if (now.detik >= iqamah && now.detik < iqamah + DURASI_JAMAAH) {
                return { fase: 'jamaah', k: k };
            }
        }

        var b = cariBerikut(now.detik);
        return { fase: 'adzan', k: b.k, besok: b.besok, target: b.target };
    }

    // ---------- Tampilan ----------
    function isiTabel(weekday) {
        URUTAN.forEach(function (k) {
            var baris = document.querySelector('tr[data-prayer="' + k + '"]');
            if (!baris) return;
            baris.querySelector('th').textContent = namaTampil(k, weekday);
            baris.querySelector('[data-col="adzan"]').textContent = formatJam(jadwal[k]);
            // Iqamah hari Jumat mengikuti khutbah, jadi tidak ditampilkan
            baris.querySelector('[data-col="iqamah"]').textContent =
                (k === 'Dhuhr' && weekday === 'Friday') ? '-' : formatJam(jadwal[k] + IQAMAH[k]);
        });
        el('sunrise').textContent = formatJam(jadwal.Sunrise);
    }

    function tampilkan(f, now) {
        var kartu = el('nextPrayer');
        var label = el('npLabel');
        var nama = el('npName');
        var waktu = el('npTime');
        var hitung = el('npCountdown');

        waktu.classList.remove('np-time--text');
        kartu.classList.toggle('is-live', f.fase !== 'adzan');

        if (f.fase === 'adzan') {
            var sisa = f.target - now.detik;
            label.textContent = 'Sholat berikutnya';
            nama.textContent = namaTampil(f.k, f.besok ? '' : now.weekday) + (f.besok ? ' (besok)' : '');
            waktu.textContent = formatJam(jadwal[f.k]);
            hitung.textContent = sisa <= AMBANG_DETIK
                ? 'Adzan dalam ' + mmss(sisa)
                : jamMenit(sisa) + ' lagi';

        } else if (f.fase === 'iqamah') {
            label.textContent = 'Menunggu iqamah';
            nama.textContent = namaTampil(f.k, now.weekday);
            waktu.textContent = formatJam(jadwal[f.k] + IQAMAH[f.k]);
            hitung.textContent = 'Iqamah dalam ' + mmss(f.target - now.detik);

        } else if (f.fase === 'jamaah') {
            var b = cariBerikut(now.detik);
            label.textContent = 'Sholat berjamaah';
            nama.textContent = namaTampil(f.k, now.weekday);
            waktu.textContent = 'Sedang berlangsung';
            waktu.classList.add('np-time--text');
            hitung.textContent = 'Berikutnya: ' +
                namaTampil(b.k, b.besok ? '' : now.weekday) + (b.besok ? ' (besok)' : '') +
                ' pukul ' + formatJam(jadwal[b.k]);

        } else { // jumat
            label.textContent = 'Hari Jumat';
            nama.textContent = 'Sholat Jumat';
            waktu.textContent = formatJam(jadwal.Dhuhr);
            hitung.textContent = 'Waktu sholat Jumat telah masuk';
        }

        // Sorot baris tabel: "is-next" untuk yang akan datang, "is-now" untuk yang sedang berlangsung
        document.querySelectorAll('#prayerTable tr[data-prayer]').forEach(function (baris) {
            var k = baris.getAttribute('data-prayer');
            var berikut = f.fase === 'adzan' && !f.besok && k === f.k;
            var sekarang = f.fase !== 'adzan' && k === f.k;
            baris.classList.toggle('is-next', berikut);
            baris.classList.toggle('is-now', sekarang);
            if (berikut || sekarang) baris.setAttribute('aria-current', 'true');
            else baris.removeAttribute('aria-current');
        });

        if (tanggalTampil !== kunciHari) {
            el('npDate').textContent = tanggalPanjang();
            tanggalTampil = kunciHari;
        }
    }

    function tampilkanGalat() {
        el('prayerError').hidden = false;
        el('nextPrayer').classList.remove('is-live');
        el('npLabel').textContent = 'Sholat berikutnya';
        el('npName').textContent = 'Jadwal belum tersedia';
        el('npTime').classList.remove('np-time--text');
        el('npTime').textContent = '--.--';
        el('npCountdown').textContent = 'Periksa koneksi internet Anda.';
        el('npDate').textContent = tanggalPanjang();
    }

    // ---------- Siklus pembaruan (1 detik) ----------
    function perbarui() {
        if (!jadwal) return;
        var now = sekarangWIB();
        var hariIni = now.y + '-' + now.m + '-' + now.d;

        // Ganti hari (lewat tengah malam WIB): jadwal lama tidak berlaku lagi
        if (hariIni !== kunciHari) {
            jadwal = null;
            muat();
            return;
        }
        tampilkan(tentukanFase(now), now);
    }

    // Ketukan diselaraskan ke pergantian detik agar angka tidak "loncat"
    function tick() {
        clearTimeout(timerId);
        perbarui();
        if (jadwal) timerId = setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
    }

    function muat() {
        if (sedangMemuat) return;
        sedangMemuat = true;
        el('prayerError').hidden = true;
        var now = sekarangWIB();

        ambilJadwal(now)
            .then(function (hasil) {
                jadwal = hasil.data;
                kunciHari = hasil.kunci;
                tanggalTampil = '';
                isiTabel(now.weekday);
                tick();
            })
            .catch(function (err) {
                console.warn('Gagal memuat jadwal sholat:', err);
                jadwal = null;
                clearTimeout(timerId);
                tampilkanGalat();
            })
            .then(function () { sedangMemuat = false; });
    }

    // ---------- Bagikan & salin ----------
    function salin(teks) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(teks).then(function () { return true; }, function () { return false; });
        }
        return new Promise(function (resolve) {
            var ta = document.createElement('textarea');
            ta.value = teks;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            resolve(ok);
        });
    }

    function bagikanHalaman() {
        var data = {
            title: document.title,
            text: "Kunjungi profil digital dan jadwal kegiatan Masjid Jami' Nurul Ilmi, Gunungpati.",
            url: window.location.href
        };
        if (navigator.share) {
            navigator.share(data).catch(function (err) {
                if (err && err.name !== 'AbortError') toast('Gagal membagikan halaman.');
            });
            return;
        }
        salin(window.location.href).then(function (ok) {
            toast(ok ? 'Tautan halaman disalin.' : 'Tautan tidak bisa disalin. Salin dari kolom alamat.');
        });
    }

    // ---------- Fallback gambar ----------
    function pasangFallbackGambar() {
        document.querySelectorAll('img[data-fallback]').forEach(function (img) {
            function tampilkanFallback() {
                var tujuan = document.querySelector(img.getAttribute('data-fallback'));
                img.hidden = true;
                if (tujuan) tujuan.hidden = false;
            }
            img.addEventListener('error', tampilkanFallback);
            if (img.complete && img.naturalWidth === 0) tampilkanFallback();
        });
    }

    // ---------- Splash screen ----------
    // Kelas "splash-on" dipasang oleh skrip kecil di <head> (hanya bila belum tampil di sesi ini
    // dan pengunjung tidak meminta pengurangan animasi).
    function jalankanSplash() {
        var root = document.documentElement;
        var splash = el('splash');
        if (!splash || !root.classList.contains('splash-on')) return;

        try { sessionStorage.setItem('splash-seen', '1'); } catch (e) { /* abaikan */ }

        var selesai = false;
        function tutup() {
            if (selesai) return;
            selesai = true;
            document.removeEventListener('keydown', tutup);
            splash.classList.add('is-hiding');
            setTimeout(function () { root.classList.remove('splash-on'); }, 450);
        }

        splash.addEventListener('click', tutup);
        document.addEventListener('keydown', tutup);
        setTimeout(tutup, DURASI_SPLASH);
    }

    // ---------- Inisialisasi ----------
    document.addEventListener('DOMContentLoaded', function () {
        jalankanSplash();

        var tahun = el('tahun');
        if (tahun) tahun.textContent = new Date().getFullYear();

        document.addEventListener('click', function (e) {
            var aksi = e.target.closest('[data-action]');
            if (!aksi) return;
            var jenis = aksi.getAttribute('data-action');
            if (jenis === 'share') bagikanHalaman();
            if (jenis === 'copy') {
                salin(aksi.getAttribute('data-copy') || '').then(function (ok) {
                    toast(ok ? 'Nomor rekening disalin.' : 'Gagal menyalin. Salin secara manual.');
                });
            }
        });

        // Tutup menu mobile setelah memilih tautan
        var menu = el('menuUtama');
        if (menu) {
            menu.addEventListener('click', function (e) {
                if (e.target.closest('a.nav-link') && menu.classList.contains('show') && window.bootstrap) {
                    window.bootstrap.Collapse.getOrCreateInstance(menu).hide();
                }
            });
        }

        var ulang = el('retryPrayer');
        if (ulang) ulang.addEventListener('click', muat);

        // Hemat baterai: berhenti saat tab tersembunyi, sinkron ulang saat kembali
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                clearTimeout(timerId);
            } else if (jadwal) {
                tick();
            } else {
                muat();
            }
        });

        // Coba lagi otomatis ketika koneksi kembali
        window.addEventListener('online', function () { if (!jadwal) muat(); });

        pasangFallbackGambar();
        muat();
    });
})();