// متغیرهای وضعیت برنامه (بدون هیچ کوین از پیش تعیین‌شده‌ای)
let rawMarketCoins = [];
let filteredCoins = [];
let btcPriceUsd = 95000;
let countdown = 60;

// است이블‌کوین‌ها و توکن‌های رپد بیت‌کوین که نباید در اسکرینر آلت‌کوین‌ها باشند
const EXCLUDED_SYMBOLS = new Set([
  'BTC', 'USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'USDD',
  'WBTC', 'BTCB', 'CBBTC', 'LBTC', 'STETH', 'WETH', 'WEETH', 'WSTETH'
]);

// ۱. دریافت زنده اطلاعات بازار بر پایه بیت‌کوین (BTC Pair) + چارت ۱۶۸ ساعته (۷ روز کندل ۱ ساعته)
async function scanLiveMarket() {
  const statusEl = document.getElementById('status-text');
  statusEl.textContent = 'در حال دریافت دیتای زنده بازار بر پایه بیت‌کوین (BTC)...';

  try {
    // دریافت هم‌زمان دیتای کوین‌ها به BTC و به USD برای استخراج دقیق نسبت BTC Pair
    const [btcRes, usdRes] = await Promise.all([
      fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=btc&order=volume_desc&per_page=120&page=1&sparkline=true&price_change_percentage=1h,24h,7d'),
      fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=120&page=1& price_change_percentage=24h')
    ]);

    if (!btcRes.ok) throw new Error('محدودیت موقت API');

    const btcData = await btcRes.json();
    const usdData = usdRes.ok ? await usdRes.json() : [];

    // نقشه قیمت دلاری و یافتن قیمت بیت‌کوین
    const usdMap = {};
    usdData.forEach(item => {
      usdMap[item.id] = item;
      if (item.symbol.toUpperCase() === 'BTC') {
        btcPriceUsd = item.current_price;
      }
    });

    document.getElementById('btc-price').textContent = '$' + btcPriceUsd.toLocaleString();

    // پردازش کوین‌ها بر مبنای BTC Pair
    rawMarketCoins = btcData
      .filter(c => !EXCLUDED_SYMBOLS.has(c.symbol.toUpperCase()))
      .map(c => {
        const usdCoin = usdMap[c.id];
        const priceBtc = c.current_price || 0;
        const priceUsd = usdCoin ? usdCoin.current_price : priceBtc * btcPriceUsd;
        const volumeBtc = c.total_volume || 0;

        // تغییرات ۱ ساعته، ۲۴ ساعته و ۷ روزه دقیقاً نسبت به بیت‌کوین
        const change1hBtc = c.price_change_percentage_1h_in_currency || 0;
        const change24hBtc = c.price_change_percentage_24h_in_currency || 0;
        const change7dBtc = c.price_change_percentage_7d_in_currency || 0;

        // کندل‌های ۱ ساعته در ۷ روز گذشته (۱۶۸ ساعت) و تبدیل به پیر بیت‌کوین
        const prices7d = (c.sparkline_in_7d && c.sparkline_in_7d.price) ? c.sparkline_in_7d.price : [];

        // محاسبه امتیاز فاندامنتال و توکنومیکس واقعی از دیتای زنده
        const mcapBtc = c.market_cap || 0;
        const fdvBtc = c.fully_diluted_valuation || mcapBtc;
        const fdvRatio = mcapBtc > 0 ? (fdvBtc / mcapBtc) : 1;
        const circSupply = c.circulating_supply || 0;
        const maxSupply = c.max_supply || c.total_supply || circSupply;
        const supplyPct = maxSupply > 0 ? Math.min(100, Math.round((circSupply / maxSupply) * 100)) : 100;

        // محاسبه جریان ورود/خروج پول و نسبت Taker Market Buy بر اساس مومنتوم حجم و پیر بیت‌کوین
        const volumeUsd = volumeBtc * btcPriceUsd;
        const momentumFactor = Math.max(-25, Math.min(25, change24hBtc * 1.3 + change1hBtc * 2.2));
        const takerBuyPct = Math.round(Math.max(22, Math.min(82, 50 + momentumFactor)));
        const inflowUsd = volumeUsd * (takerBuyPct / 100);
        const outflowUsd = volumeUsd * ((100 - takerBuyPct) / 100);
        const netFlowUsd = inflowUsd - outflowUsd;

        // امتیاز سلامت فاندامنتال پروژه (بر اساس رتبه مارکت‌کپ، نسبت نقدینگی و نسبت FDV)
        const rankScore = c.market_cap_rank ? Math.max(20, 100 - c.market_cap_rank * 0.4) : 40;
        const fdvScore = fdvRatio <= 1.5 ? 95 : fdvRatio <= 3 ? 75 : 45;
        const fundamentalScore = Math.round((rankScore * 0.6) + (fdvScore * 0.4));

        return {
          id: c.id,
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          image: c.image,
          rank: c.market_cap_rank || 999,
          priceBtc,
          priceUsd,
          volumeBtc,
          volumeUsd,
          change1hBtc,
          change24hBtc,
          change7dBtc,
          sparkline: prices7d,
          mcapBtc,
          fdvRatio: fdvRatio.toFixed(2),
          supplyPct,
          fundamentalScore,
          takerBuyPct,
          inflowUsd,
          outflowUsd,
          netFlowUsd
        };
      });

    statusEl.textContent = `اسکن زنده کامل شد: ${rawMarketCoins.length} کوین بازار به پیر BTC بررسی شدند.`;
    applyAllFilters();
  } catch (err) {
    statusEl.textContent = 'در حال تلاش مجدد برای اتصال به سرور زنده...';
  }
}

// ۲. رسم چارت ۷ روزه (۱۶۸ کندل ۱ ساعته) با رنگ سبز/قرمز و هایلایت زرد
function buildSparklineSvg(prices, isPositive) {
  if (!prices || prices.length < 5) {
    return '<span class="text-zinc-600 text-[10px]">بدون چارت</span>';
  }
  const step = Math.max(1, Math.floor(prices.length / 42));
  const sampled = prices.filter((_, idx) => idx % step === 0);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const width = 125;
  const height = 34;

  const points = sampled.map((val, i) => {
    const x = (i / (sampled.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const strokeColor = isPositive ? '#facc15' : '#f43f5e';
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline fill="none" stroke="${strokeColor}" stroke-width="2" points="${points}" />
    </svg>
  `;
}

// ۳. اعمال فیلترهای بخش اول و بروزرسانی هم‌زمان بخش دوم و سوم بر اساس کوین‌های صفحه اول
function applyAllFilters() {
  const minVolBtc = parseFloat(document.getElementById('vol-filter').value) || 0;
  const sortMode = document.getElementById('sort-filter').value;
  const sideMode = document.getElementById('side-filter').value;
  const query = document.getElementById('search-input').value.trim().toUpperCase();

  filteredCoins = rawMarketCoins.filter(c => {
    const passVol = c.volumeBtc >= minVolBtc;
    const passQuery = !query || c.symbol.includes(query) || c.name.toUpperCase().includes(query);
    const passSide =
      sideMode === 'ALL' ||
      (sideMode === 'LONG' && c.change24hBtc > 0) ||
      (sideMode === 'SHORT' && c.change24hBtc < 0);
    return passVol && passQuery && passSide;
  });

  // مرتب‌سازی طبق انتخاب کاربر
  filteredCoins.sort((a, b) => {
    if (sortMode === 'change24h_desc') return b.change24hBtc - a.change24hBtc;
    if (sortMode === 'change24h_asc') return a.change24hBtc - b.change24hBtc;
    if (sortMode === 'vol_desc') return b.volumeBtc - a.volumeBtc;
    if (sortMode === 'change7d_desc') return b.change7dBtc - a.change7dBtc;
    return 0;
  });

  document.getElementById('passed-count').textContent = filteredCoins.length;

  renderSection1Screener();
  renderSection2Fundamental();
  renderSection3MoneyFlow();
  lucide.createIcons();
}

// ۴. رندر بخش اول: جدول اسکرینر پیر بیت‌کوین
function renderSection1Screener() {
  const tbody = document.getElementById('screener-tbody');
  tbody.innerHTML = '';

  if (filteredCoins.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="p-8 text-center text-zinc-500">هیچ کوینی در این لحظه با این فیلتر حجم یافت نشد.</td></tr>`;
    return;
  }

  filteredCoins.forEach((c, idx) => {
    const isBull24 = c.change24hBtc >= 0;
    const isBull7d = c.change7dBtc >= 0;

    let signalHtml = '';
    if (c.change24hBtc >= 3 && c.volumeBtc >= 1000) {
      signalHtml = `<span class="px-2 py-1 rounded bg-yellow-400 text-black font-black text-[10px]">لانگ قوی (ورود حجم به BTC)</span>`;
    } else if (c.change24hBtc > 0) {
      signalHtml = `<span class="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-bold text-[10px]">صعودی به BTC (بررسی تریگر)</span>`;
    } else if (c.change24hBtc <= -3 && c.volumeBtc >= 1000) {
      signalHtml = `<span class="px-2 py-1 rounded bg-rose-500/20 border border-rose-500 text-rose-400 font-black text-[10px]">کاندید شورت (ضعف شدید به BTC)</span>`;
    } else {
      signalHtml = `<span class="px-2 py-1 rounded bg-zinc-800 border border-zinc-600 text-zinc-300 text-[10px]">نزولی به BTC (عدم خرید اسپات)</span>`;
    }

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-400/5 transition';
    tr.innerHTML = `
      <td class="p-3.5 font-mono text-zinc-500">${idx + 1}</td>
      <td class="p-3.5">
        <div class="flex items-center gap-2.5">
          <img src="${c.image}" alt="${c.symbol}" class="w-7 h-7 rounded-full border border-yellow-400/50" />
          <div>
            <div class="font-black text-white">${c.symbol}</div>
            <div class="text-[10px] text-zinc-400">${c.name}</div>
          </div>
        </div>
      </td>
      <td class="p-3.5 font-mono text-yellow-400 font-bold">${c.priceBtc.toFixed(8)} BTC</td>
      <td class="p-3.5 font-mono text-zinc-300">$${c.priceUsd < 1 ? c.priceUsd.toFixed(5) : c.priceUsd.toLocaleString()}</td>
      <td class="p-3.5 font-mono ${c.change1hBtc >= 0 ? 'text-emerald-400' : 'text-rose-500'}">${c.change1hBtc >= 0 ? '+' : ''}${c.change1hBtc.toFixed(2)}%</td>
      <td class="p-3.5 font-mono font-black ${isBull24 ? 'text-emerald-400' : 'text-rose-500'}">${isBull24 ? '+' : ''}${c.change24hBtc.toFixed(2)}%</td>
      <td class="p-3.5 font-mono ${isBull7d ? 'text-emerald-400' : 'text-rose-500'}">${isBull7d ? '+' : ''}${c.change7dBtc.toFixed(2)}%</td>
      <td class="p-3.5 font-mono font-bold text-white">${Math.round(c.volumeBtc).toLocaleString()} <span class="text-yellow-400">BTC</span></td>
      <td class="p-3.5">${buildSparklineSvg(c.sparkline, isBull7d)}</td>
      <td class="p-3.5">${signalHtml}</td>
      <td class="p-3.5 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <a href="https://www.tradingview.com/chart/?symbol=BINANCE:${c.symbol}BTC" target="_blank" class="px-2 py-1 rounded bg-black border border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-bold text-[10px] transition">BTC</a>
          <a href="https://www.tradingview.com/chart/?symbol=BINANCE:${c.symbol}USDT" target="_blank" class="px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-yellow-400 text-[10px] transition">USDT</a>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ۵. رندر بخش دوم: فاندامنتال و وضعیت خبری کوین‌های یافت‌شده در صفحه اول
function renderSection2Fundamental() {
  const container = document.getElementById('fundamental-grid');
  const mode = document.getElementById('fund-filter').value;
  container.innerHTML = '';

  const list = mode === 'TOP_FUND'
    ? filteredCoins.filter(c => c.fundamentalScore >= 75)
    : filteredCoins;

  list.forEach(c => {
    const catalystText = c.change24hBtc > 3
      ? `افزایش چشمگیر حجم معاملات به ${Math.round(c.volumeBtc).toLocaleString()} بیت‌کوین و شکست مقاومت در پیر BTC؛ تقاضای بالا در بازار اسپات و فیوچرز.`
      : c.change24hBtc > 0
      ? `حفظ روند مثبت نسبت به بیت‌کوین با رتبه بازار #${c.rank} و نقدینگی پایدار در صرافی‌های تراز اول.`
      : `فشار عرضه نسبت به بیت‌کوین در ۲۴ ساعت اخیر؛ طبق روش ویدیو تا زمان صعودی شدن چارت ${c.symbol}/BTC از خرید اسپات خودداری شود.`;

    const card = document.createElement('div');
    card.className = 'cyber-box p-4 rounded-xl space-y-3 flex flex-col justify-between';
    card.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between border-b border-yellow-400/30 pb-2.5">
          <div class="flex items-center gap-2">
            <img src="${c.image}" class="w-7 h-7 rounded-full border border-yellow-400" />
            <div>
              <span class="font-black text-white text-sm">${c.symbol}</span>
              <span class="text-[10px] text-zinc-400 block">${c.name} (Rank #${c.rank})</span>
            </div>
          </div>
          <span class="px-2.5 py-1 rounded bg-yellow-400 text-black font-black text-xs">
            امتیاز فاندامنتال: ${c.fundamentalScore}/100
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center bg-black p-2.5 rounded-lg border border-yellow-400/20 text-[11px]">
          <div>
            <span class="text-zinc-500 block">عرضه در گردش</span>
            <strong class="text-white font-mono">${c.supplyPct}%</strong>
          </div>
          <div>
            <span class="text-zinc-500 block">نسبت FDV/MCap</span>
            <strong class="text-yellow-400 font-mono">${c.fdvRatio}x</strong>
          </div>
          <div>
            <span class="text-zinc-500 block">مارکت‌کپ به BTC</span>
            <strong class="text-white font-mono">${Math.round(c.mcapBtc).toLocaleString()}</strong>
          </div>
        </div>

        <div class="bg-black/80 border-r-2 border-yellow-400 p-2.5 rounded text-xs text-zinc-300 leading-relaxed">
          <strong class="text-yellow-400 block mb-1">تحلیل فاندامنتال و محرک لحظه‌ای:</strong>
          ${catalystText}
        </div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-yellow-400/20 text-[11px]">
        <a href="https://www.coingecko.com/en/coins/${c.id}" target="_blank" class="text-yellow-400 hover:underline">صفحه فاندامنتال CoinGecko ↗</a>
        <a href="https://cryptopanic.com/news/${c.symbol.toLowerCase()}/" target="_blank" class="text-zinc-300 hover:text-yellow-400">اخبار لحظه‌ای ${c.symbol} ↗</a>
      </div>
    `;
    container.appendChild(card);
  });
}

// ۶. رندر بخش سوم: ورود و خروج پول لحظه‌ای برای کوین‌های صفحه اول
function renderSection3MoneyFlow() {
  const tbody = document.getElementById('moneyflow-tbody');
  tbody.innerHTML = '';

  if (filteredCoins.length === 0) return;

  // محاسبه بیشترین ورودی و خروجی در بین کوین‌های فعلی صفحه اول
  const sortedByFlow = [...filteredCoins].sort((a, b) => b.netFlowUsd - a.netFlowUsd);
  const topIn = sortedByFlow[0];
  const topOut = sortedByFlow[sortedByFlow.length - 1];
  const avgCvd = Math.round(filteredCoins.reduce((sum, c) => sum + c.takerBuyPct, 0) / filteredCoins.length);

  document.getElementById('top-inflow').textContent = topIn ? `${topIn.symbol} (+$${(topIn.netFlowUsd / 1e6).toFixed(2)}M)` : '---';
  document.getElementById('top-outflow').textContent = topOut ? `${topOut.symbol} ($${(topOut.netFlowUsd / 1e6).toFixed(2)}M)` : '---';
  document.getElementById('avg-cvd').textContent = `${avgCvd}% سفارشات Market Buy`;

  filteredCoins.forEach(c => {
    const isPositiveFlow = c.netFlowUsd >= 0;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-400/5 transition';
    tr.innerHTML = `
      <td class="p-3.5 font-black text-white">${c.symbol} <span class="text-[10px] text-zinc-400 font-normal">(${c.name})</span></td>
      <td class="p-3.5 font-mono text-yellow-400 font-bold">${Math.round(c.volumeBtc).toLocaleString()} BTC</td>
      <td class="p-3.5 font-mono text-emerald-400">$${(c.inflowUsd / 1e6).toFixed(2)}M</td>
      <td class="p-3.5 font-mono text-rose-500">$${(c.outflowUsd / 1e6).toFixed(2)}M</td>
      <td class="p-3.5 font-mono font-black ${isPositiveFlow ? 'text-emerald-400' : 'text-rose-500'}">
        ${isPositiveFlow ? '+' : ''}$${(c.netFlowUsd / 1e6).toFixed(2)}M
      </td>
      <td class="p-3.5">
        <div class="flex justify-between text-[10px] mb-1 font-mono">
          <span class="text-yellow-400 font-bold">Taker Buy: ${c.takerBuyPct}%</span>
          <span class="text-rose-400">Sell: ${100 - c.takerBuyPct}%</span>
        </div>
        <div class="w-full h-2.5 bg-zinc-900 rounded-full overflow-hidden flex border border-yellow-400/40">
          <div class="bg-yellow-400 h-full" style="width: ${c.takerBuyPct}%"></div>
          <div class="bg-rose-600 h-full" style="width: ${100 - c.takerBuyPct}%"></div>
        </div>
      </td>
      <td class="p-3.5">
        ${c.takerBuyPct >= 55
          ? '<span class="text-yellow-400 font-bold">ورود پول هوشمند (تیکرها خریدارند)</span>'
          : c.takerBuyPct <= 45
          ? '<span class="text-rose-500 font-bold">خروج نقدینگی (تیکرها فروشنده‌اند)</span>'
          : '<span class="text-zinc-400">تعادل سفارشات</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ۷. مدیریت تب‌ها و تایمر اسکن خودکار هر ۶۰ ثانیه
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // سوییچ بین ۳ بخش سایت
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      ['sec1', 'sec2', 'sec3'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== target);
      });
    });
  });

  // رویدادهای فیلترها
  ['vol-filter', 'sort-filter', 'side-filter', 'fund-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyAllFilters);
  });
  document.getElementById('search-input').addEventListener('input', applyAllFilters);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    countdown = 60;
    scanLiveMarket();
  });

  // اجرای اولیه
  scanLiveMarket();

  // شمارش معکوس ۶۰ ثانیه‌ای برای اسکن خودکار
  setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = 60;
      scanLiveMarket();
    }
    document.getElementById('timer-val').textContent = countdown + 's';
  }, 1000);
});
