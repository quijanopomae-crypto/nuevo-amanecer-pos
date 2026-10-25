/* Nuevo Amanecer CANON — decorador visual del Inicio para tablet y escritorio. */
(function (root) {
  'use strict';

  // La estructura del Inicio para PC/tablet (barra lateral, encabezado, tendencia de ventas, actividad y
  // pendientes) está escrita una sola vez en index.html. Este archivo solo la rellena con datos: ya no
  // construye una segunda copia del DOM.
  function ensureDashboardDom() {
    const page = document.getElementById('pageMenu');
    if (!page) return false;
    return !!page.querySelector('.main-scroll.home-shell');
  }

  function localIso(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function recentTimestamp(sale) {
    const rawDate = String(sale && sale.fecha || '');
    const rawTime = String(sale && (sale.hora24 || sale.hora) || '00:00:00').slice(0, 8);
    const parsed = Date.parse(rawDate + 'T' + (/^\d{2}:\d{2}/.test(rawTime) ? rawTime : '00:00:00'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateDesktopDashboard() {
    if (!ensureDashboardDom()) return;
    const now = new Date(), yesterdayDate = new Date(now.getTime());
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const today = typeof obtenerHoy === 'function' ? obtenerHoy() : localIso(now);
    const yesterday = localIso(yesterdayDate);
    const rows = typeof ventas !== 'undefined' && Array.isArray(ventas) ? ventas : [];
    const todaySales = rows.filter(function (sale) { return sale && sale.fecha === today && !sale.anulada; });
    const ayerVentas = rows.filter(function (sale) { return sale && sale.fecha === yesterday && !sale.anulada; });
    const saleTotal = function (sale) { return typeof totalV === 'function' ? Number(totalV(sale)) || 0 : Number(sale && sale.total) || 0; };
    const money = function (value) { return typeof fmt === 'function' ? fmt(value) : 'S/ ' + Number(value || 0).toFixed(2); };
    const todayTotal = todaySales.reduce(function (sum, sale) { return sum + saleTotal(sale); }, 0);
    const yesterdayTotal = ayerVentas.reduce(function (sum, sale) { return sum + saleTotal(sale); }, 0);

    const trend = document.getElementById('qsVentasTrend');
    const previous = document.getElementById('qsVentasPrev');
    if (trend) {
      if (yesterdayTotal > 0) {
        const pct = ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100;
        const up = pct > 0.049, down = pct < -0.049;
        trend.dataset.trend = up ? 'up' : down ? 'down' : 'flat';
        trend.textContent = (up ? '↑' : down ? '↓' : '—') + ' ' + Math.abs(pct).toFixed(1) + '% vs ayer';
      } else if (todayTotal > 0) {
        trend.dataset.trend = 'up';
        trend.textContent = '↑ Sin ventas ayer';
      } else {
        trend.dataset.trend = 'flat';
        trend.textContent = '— Sin variación vs ayer';
      }
    }
    if (previous) previous.textContent = 'Ayer: ' + money(yesterdayTotal);

    const dateLabel = document.getElementById('menuDesktopDate');
    if (dateLabel) dateLabel.textContent = now.toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long' });

    const recent = rows.filter(function (sale) { return sale && !sale.anulada; }).slice().sort(function (a, b) {
      return recentTimestamp(b) - recentTimestamp(a);
    }).slice(0, 3);
    for (let i = 0; i < 3; i += 1) {
      const label = document.getElementById('menuActivity' + i + 'Label');
      const amount = document.getElementById('menuActivity' + i + 'Amount');
      const sale = recent[i];
      if (!label || !amount) continue;
      if (!sale) {
        label.textContent = i === 0 ? 'Sin movimientos recientes' : '—';
        amount.textContent = '—';
        continue;
      }
      const id = String(sale.id || 'Venta').replace(/^V-/, '#');
      const time = String(sale.hora24 || sale.hora || '').slice(0, 5);
      label.textContent = 'Venta ' + id + (time ? ' · ' + time : '');
      amount.textContent = money(saleTotal(sale));
    }

    const pendingCredits = document.getElementById('menuPendingCredits');
    const pendingStock = document.getElementById('menuPendingStock');
    const pendingCash = document.getElementById('menuPendingCash');
    const debtValue = document.getElementById('qsPorCobrar')?.textContent || 'S/ 0.00';
    const debtCount = document.getElementById('qsPorCobrarSub')?.textContent || 'Sin créditos activos';
    const stockValue = document.getElementById('qsStockCritico')?.textContent || '0';
    const stockCopy = document.getElementById('qsStockCriticoSub')?.textContent || 'productos por reponer';
    const cashState = document.getElementById('qsCajaSub')?.textContent || 'Caja no abierta';
    if (pendingCredits) pendingCredits.textContent = debtCount + ' · ' + debtValue;
    if (pendingStock) pendingStock.textContent = stockValue + ' ' + stockCopy;
    if (pendingCash) pendingCash.textContent = cashState;
  }

  function bindDashboardRenderer() {
    if (typeof updateDashboard !== 'function' || updateDashboard.__naDesktopDashboard) return;
    const base = updateDashboard;
    const wrapped = function () {
      const result = base.apply(this, arguments);
      try { updateDesktopDashboard(); } catch (error) { console.warn('[Nuevo Amanecer] No se pudo actualizar el dashboard de escritorio.', error && error.message || error); }
      return result;
    };
    wrapped.__naDesktopDashboard = true;
    updateDashboard = wrapped;
  }

  function init() {
    ensureDashboardDom();
    bindDashboardRenderer();
    try { updateDesktopDashboard(); } catch (error) { console.warn('[Nuevo Amanecer] No se pudo iniciar el dashboard de escritorio.', error && error.message || error); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
  root.addEventListener('pageshow', init);
  root.addEventListener('na:canonical-updated', function () { setTimeout(updateDesktopDashboard, 0); });

  root.NA_CANON_DESKTOP_DASHBOARD = Object.freeze({ ensure:ensureDashboardDom, refresh:updateDesktopDashboard });
})(window);
