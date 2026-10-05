// Lógica do relatório de Acompanhamento Comercial (roteirização x vendas)
// Consome window.REPORT_DATA (embutido pelo gerar_relatorio.py)
(function () {
  "use strict";
  var DATA = window.REPORT_DATA || { visits: [], sales: [], faturado: [], vendorMeta: {} };
  var META = DATA.vendorMeta || {};
  var CLIENTE_NOME_BACKEND = DATA.clienteNome || {};
  var CLIENTE_NOME_CARTEIRA = {};
  (DATA.carteira || []).forEach(function (c) { if (!CLIENTE_NOME_CARTEIRA[c.cli]) CLIENTE_NOME_CARTEIRA[c.cli] = c.n; });
  function nomeCliente(cli) {
    return CLIENTE_NOME_CARTEIRA[cli] || CLIENTE_NOME_BACKEND[String(cli)] || ("Cliente " + cli);
  }
  var state = { canal: "geral", gerente: "", vendedor: "", cidade: "", mes: "", dataIni: "", dataFim: "" };
  var sortState = { key: "pct", dir: "asc" };
  var CANAL_MAP = { alimentar: "Alimentar", exclusiva: "Exclusiva" };
  var MESES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  // ---------------- formatação ----------------
  function fmtInt(n) { return (n || 0).toLocaleString("pt-BR"); }
  function fmtPct(n) { return (isFinite(n) ? n : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
  function fmtMoney(n) { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); }
  function fmtMoneyShort(n) {
    var a = Math.abs(n || 0);
    if (a >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
    if (a >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return fmtMoney(n);
  }
  function fmtDuration(sec) {
    var s = Math.round(sec || 0), m = Math.floor(s / 60), h = Math.floor(m / 60);
    m = m % 60; s = s % 60;
    return h > 0 ? h + "h " + String(m).padStart(2, "0") + "min" : m + "min " + String(s).padStart(2, "0") + "s";
  }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shortName(n) { var t = String(n || "").split(/\s+/).filter(Boolean); return t.length > 2 ? t[0] + " " + t[t.length - 1] : (n || "—"); }
  function dBR(iso) { return iso ? iso.split("-").reverse().join("/") : ""; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------------- filtros ----------------
  function inCanal(ca) { return state.canal === "geral" || ca === CANAL_MAP[state.canal]; }
  function passDate(d) {
    if (state.mes && d.slice(0, 7) !== state.mes) return false;
    if (state.dataIni && d < state.dataIni) return false;
    if (state.dataFim && d > state.dataFim) return false;
    return true;
  }
  function passPessoa(vc, nomeVisita, gerVisita) {
    if (!state.gerente && !state.vendedor) return true;
    var m = nomeVisita !== undefined ? { nome: nomeVisita, gerente: gerVisita } : META[String(vc)];
    if (!m || m.semRoteiro) return false;
    if (state.gerente && m.gerente !== state.gerente) return false;
    if (state.vendedor && m.nome !== state.vendedor) return false;
    return true;
  }
  function filteredVisits() {
    return DATA.visits.filter(function (v) {
      return inCanal(v.ca) && passPessoa(null, v.v, v.g) && (!state.cidade || v.ci === state.cidade) && passDate(v.d);
    });
  }
  function filteredSales() {
    if (DATA.sales_legacy) {
      // layout novo (sem vendedor/data/pedido por linha): mesmos filtros da venda faturada legada
      // (canal, vendedor aproximado, cidade, mês) - sem data real por pedido
      var mesNome = state.mes ? MESES[parseInt(state.mes.split("-")[1], 10)] : null;
      return DATA.sales.filter(function (s) {
        if (!inCanal(s.ca)) return false;
        if ((state.gerente || state.vendedor) && (s.vc == null || !passPessoa(s.vc))) return false;
        if (state.cidade && s.ci !== state.cidade) return false;
        if (mesNome && s.mes !== mesNome) return false;
        return true;
      });
    }
    return DATA.sales.filter(function (s) {
      return inCanal(s.ca) && passPessoa(s.vc) && (!state.cidade || s.ci === state.cidade) && passDate(s.d);
    });
  }
  function filteredFat() {
    if (DATA.faturado_legacy) {
      var mesNome = state.mes ? MESES[parseInt(state.mes.split("-")[1], 10)] : null;
      return DATA.faturado.filter(function (f) {
        if (!inCanal(f.ca)) return false;
        if ((state.gerente || state.vendedor) && (f.vc == null || !passPessoa(f.vc))) return false;
        if (state.cidade && f.ci !== state.cidade) return false;
        if (mesNome && f.mes !== mesNome) return false;
        return true;
      });
    }
    // layout novo: mesmo formato/filtros da venda ingressada (vendedor, cidade, mês, data real)
    return DATA.faturado.filter(function (f) {
      return inCanal(f.ca) && passPessoa(f.vc) && (!state.cidade || f.ci === state.cidade) && passDate(f.d);
    });
  }
  // carteira ativa (Alimentar/Exclusiva) não tem data própria - segue canal/gerente/vendedor/cidade
  function filteredCarteira() {
    return (DATA.carteira || []).filter(function (c) {
      return inCanal(c.ca) && passPessoa(c.vc) && (!state.cidade || c.ci === state.cidade);
    });
  }
  // (vendedor, cliente) com pelo menos uma visita planejada no período/filtro atual
  function plannedPairs(visits) {
    var s = new Set();
    visits.forEach(function (v) { if (v.vc != null && v.cli != null) s.add(v.vc + "|" + v.cli); });
    return s;
  }

  function fillSelect(id, values, allLabel, current, labelFn) {
    var el = document.getElementById(id);
    el.innerHTML = '<option value="">' + allLabel + "</option>" + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(labelFn ? labelFn(v) : v) + "</option>";
    }).join("");
    el.value = values.indexOf(current) !== -1 ? current : "";
    return el.value;
  }
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); }); }

  function refreshFilterOptions() {
    var base = DATA.visits.filter(function (v) { return inCanal(v.ca); });
    state.gerente = fillSelect("fGerente", uniq(base.map(function (v) { return v.g; })), "Todos", state.gerente);
    var baseV = base.filter(function (v) { return !state.gerente || v.g === state.gerente; });
    state.vendedor = fillSelect("fVendedor", uniq(baseV.map(function (v) { return v.v; })), "Todos", state.vendedor);
    state.cidade = fillSelect("fCidade", uniq(base.map(function (v) { return v.ci; })), "Todas", state.cidade);
    state.mes = fillSelect("fMes", uniq(base.map(function (v) { return v.d.slice(0, 7); })), "Todos", state.mes, function (m) {
      return MESES[parseInt(m.split("-")[1], 10)] + " / " + m.split("-")[0];
    });
  }

  // ---------------- KPIs de roteirização ----------------
  function card(label, value, sub) {
    return '<div class="kpi-card"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div><div class="kpi-sub">' + (sub || "&nbsp;") + "</div></div>";
  }
  function renderKPIs(visits) {
    var planned = visits.length, realized = 0, justified = 0, conv = 0, sec = 0;
    visits.forEach(function (v) {
      if (v.r) { realized++; sec += v.s; if (v.cv) conv++; }
      if (v.j) justified++;
    });
    var naoReal = planned - realized;
    var convCard = DATA.conversao_disponivel === false
      ? card("Conversão de vendas", "Indisponível", "export atual de venda ingressada sem data do pedido")
      : card("Conversão de vendas", fmtPct(realized ? conv / realized * 100 : 0), fmtInt(conv) + " visitas realizadas geraram pedido");
    document.getElementById("kpiGrid").innerHTML =
      card("Visitas planejadas", fmtInt(planned), "no período filtrado") +
      card("Visitas realizadas", fmtInt(realized), "<b>" + fmtPct(planned ? realized / planned * 100 : 0) + "</b> de cumprimento do roteiro") +
      card("Justificativas", fmtInt(justified), naoReal ? "<b>" + fmtPct(justified / naoReal * 100) + "</b> das " + fmtInt(naoReal) + " não realizadas" : "") +
      convCard +
      card("Tempo médio de permanência", fmtDuration(realized ? sec / realized : 0), "por visita realizada");
  }

  // ---------------- KPIs de vendas x roteiro ----------------
  function renderSales(sales) {
    var temFr = !DATA.sales_legacy;
    var tot = 0, rota = 0, fora = 0, semr = 0, npFora = 0;
    sales.forEach(function (s) {
      tot += s.val;
      if (!temFr) return;
      if (s.fr === 0) rota += s.val;
      else if (s.fr === 1) { fora += s.val; npFora += s.np; }
      else semr += s.val;
    });
    var fatRows = filteredFat();
    var fat = 0, fatRota = 0, fatFora = 0;
    fatRows.forEach(function (f) {
      fat += f.val;
      if (!DATA.faturado_legacy) { if (f.fr === 0) fatRota += f.val; else if (f.fr === 1) fatFora += f.val; }
    });
    var fatSub = DATA.faturado_legacy ? "clientes atribuídos ao vendedor da rota (aproximado)"
      : (fatRota + fatFora ? "<b>" + fmtPct(fatFora / (fatRota + fatFora) * 100) + "</b> faturada fora do roteiro" : "por vendedor e data reais da nota");
    var roteirizados = rota + fora;
    var cards = card("Venda ingressada (total)", fmtMoneyShort(tot), fmtMoney(tot)) +
      card("Venda faturada", fmtMoneyShort(fat), fatSub);
    if (temFr) {
      cards += card("Venda em rota", fmtMoneyShort(rota), "<b>" + fmtPct(roteirizados ? rota / roteirizados * 100 : 0) + "</b> da venda dos vendedores roteirizados") +
        card("Venda fora do roteiro", fmtMoneyShort(fora), "<b>" + fmtPct(roteirizados ? fora / roteirizados * 100 : 0) + "</b> · " + fmtInt(npFora) + " pedidos");
    } else {
      cards += card("Venda em rota", "Indisponível", "export atual sem data do pedido para classificar") +
        card("Venda fora do roteiro", "Indisponível", "atribuída por cliente/mês (aproximado), sem data real");
    }
    document.getElementById("salesGrid").innerHTML = cards;

    // top 10 fora do roteiro (vendedores roteirizados; key accounts sem rota fixa ficam fora desse ranking)
    // ranking entre vendedores não faz sentido com um único vendedor já selecionado no filtro;
    // tambem indisponivel quando a venda ingressada nao traz classificacao real em rota
    var panelFora = document.getElementById("panelFora");
    if (state.vendedor || !temFr) {
      panelFora.style.display = "none";
    } else {
      panelFora.style.display = "";
      var byV = {};
      sales.forEach(function (s) {
        if (s.fr === 2) return;
        var k = String(s.vc);
        if (!byV[k]) byV[k] = { fora: 0, tot: 0 };
        byV[k].tot += s.val;
        if (s.fr === 1) byV[k].fora += s.val;
      });
      var arr = Object.keys(byV).map(function (k) { return { name: (META[k] || {}).nome || k, v: byV[k].fora, p: byV[k].tot ? byV[k].fora / byV[k].tot * 100 : 0 }; })
        .filter(function (a) { return a.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
      renderRank("rankFora", arr, function (a) { return fmtMoneyShort(a.v) + "<small>" + fmtPct(a.p) + "</small>"; }, arr.length ? arr[0].v : 1, "Sem vendas fora do roteiro no período.");
    }
  }

  // ---------------- carteira x roteirização ----------------
  var carteiraSemRota = [];
  function renderCarteira(visits) {
    var planned = plannedPairs(visits);
    var rows = filteredCarteira();
    carteiraSemRota = [];
    var vendedoresTot = {}, vendedoresSem = {};
    rows.forEach(function (c) {
      vendedoresTot[c.vc] = true;
      if (!planned.has(c.vc + "|" + c.cli)) { carteiraSemRota.push(c); vendedoresSem[c.vc] = true; }
    });
    carteiraSemRota.sort(function (a, b) {
      var an = (META[String(a.vc)] || {}).nome || String(a.vc), bn = (META[String(b.vc)] || {}).nome || String(b.vc);
      return an.localeCompare(bn, "pt-BR") || a.n.localeCompare(b.n, "pt-BR");
    });
    var total = rows.length, sem = carteiraSemRota.length;
    var clientesVisitados = new Set();
    visits.forEach(function (v) { if (v.r && v.cli != null) clientesVisitados.add(v.cli); });
    document.getElementById("carteiraGrid").innerHTML =
      card("Clientes na carteira (ativos)", fmtInt(total), "Alimentar + Exclusiva, conforme filtro atual") +
      card("Sem roteiro no sistema de rotas", fmtInt(sem), total ? "<b>" + fmtPct(sem / total * 100) + "</b> da carteira ativa filtrada" : "&nbsp;") +
      card("Vendedores com clientes sem roteiro", fmtInt(Object.keys(vendedoresSem).length), "de " + fmtInt(Object.keys(vendedoresTot).length) + " vendedores com carteira no filtro") +
      card("Clientes visitados no período", fmtInt(clientesVisitados.size), "clientes distintos com visita realizada, conforme filtros atuais");
    renderCarteiraTable();
  }

  function renderCarteiraTable() {
    var rows = carteiraSemRota;
    var q = (document.getElementById("carteiraSearch").value || "").toLowerCase();
    if (q) {
      rows = rows.filter(function (c) {
        var m = META[String(c.vc)] || {};
        return c.n.toLowerCase().indexOf(q) !== -1 || (m.nome || "").toLowerCase().indexOf(q) !== -1;
      });
    }
    document.getElementById("carteiraBody").innerHTML = rows.length ? rows.map(function (c) {
      var m = META[String(c.vc)] || {};
      return "<tr><td class='txt'>" + esc(c.n) + "</td><td class='txt'>" + esc(c.ci) + "</td><td class='txt'>" + esc(m.nome || ("Vendedor " + c.vc)) +
        "</td><td class='txt'><span title='" + esc(m.gerente || "") + "'>" + esc(shortName(m.gerente)) + "</span></td><td class='txt'>" + esc(c.ca) + "</td></tr>";
    }).join("") : '<tr><td colspan="5"><div class="empty-state">Nenhum cliente da carteira sem roteiro com os filtros atuais.</div></td></tr>';
    var wrap = document.getElementById("carteiraTableWrap");
    wrap.style.maxHeight = wrap.querySelectorAll("tbody tr").length > 10 ? "" : "none";
    document.getElementById("carteiraCount").textContent = rows.length + " cliente(s) sem roteiro · role a tabela para ver todos";
  }

  // ---------------- clientes fora da carteira (visão de um único vendedor) ----------------
  var foraCarteiraRows = [];
  function vendedorCodePorNome(nome) {
    for (var k in META) { if (META[k].nome === nome) return k; }
    return null;
  }
  function renderForaCarteira(sales) {
    var painel = document.getElementById("panelForaCarteira");
    if (!state.vendedor) { painel.style.display = "none"; return; }
    var vc = vendedorCodePorNome(state.vendedor);
    painel.style.display = "";
    document.getElementById("foraCarteiraVendedor").textContent = state.vendedor;
    var clientesCarteira = {};
    (DATA.carteira || []).forEach(function (c) { if (String(c.vc) === vc) clientesCarteira[c.cli] = true; });
    var byCli = {};
    sales.forEach(function (s) {
      if (String(s.vc) !== vc || s.cli == null || clientesCarteira[s.cli]) return;
      if (!byCli[s.cli]) byCli[s.cli] = { cli: s.cli, val: 0, np: 0 };
      byCli[s.cli].val += s.val; byCli[s.cli].np += s.np;
    });
    foraCarteiraRows = Object.keys(byCli).map(function (k) { return byCli[k]; })
      .sort(function (a, b) { return b.val - a.val; });
    renderForaCarteiraTable();
  }
  function renderForaCarteiraTable() {
    var rows = foraCarteiraRows;
    var q = (document.getElementById("foraCarteiraSearch").value || "").toLowerCase();
    if (q) rows = rows.filter(function (c) { return nomeCliente(c.cli).toLowerCase().indexOf(q) !== -1; });
    document.getElementById("foraCarteiraBody").innerHTML = rows.length ? rows.map(function (c) {
      return "<tr><td class='txt'>" + esc(nomeCliente(c.cli)) + "</td><td>" + fmtMoney(c.val) + "</td><td>" + fmtInt(c.np) + "</td></tr>";
    }).join("") : '<tr><td colspan="3"><div class="empty-state">Nenhuma venda fora da carteira registrada para este vendedor no período filtrado.</div></td></tr>';
    var wrap = document.getElementById("foraCarteiraTableWrap");
    wrap.style.maxHeight = wrap.querySelectorAll("tbody tr").length > 10 ? "" : "none";
    document.getElementById("foraCarteiraCount").textContent = rows.length + " cliente(s) fora da carteira · role a tabela para ver todos";
  }

  // ---------------- ranking genérico ----------------
  function renderRank(id, arr, valFn, max, emptyMsg) {
    var el = document.getElementById(id);
    if (!arr.length) { el.innerHTML = '<div class="empty-state">' + emptyMsg + "</div>"; return; }
    el.innerHTML = arr.map(function (a, i) {
      var w = max > 0 ? Math.max(0, (a.bar != null ? a.bar : a.v) / max * 100) : 0;
      return '<div class="rank-item"><div class="rank-idx">' + (i + 1) + '</div><div class="rank-name" title="' + esc(a.name) + '">' + esc(a.name) +
        '</div><div class="rank-val">' + valFn(a) + '</div><div class="rank-track"><div class="rank-fill" style="width:' + w + '%"></div></div></div>';
    }).join("");
  }

  function renderVisitasStats(visits) {
    var clientesVisitados = new Set();
    visits.forEach(function (v) { if (v.r && v.cli != null) clientesVisitados.add(v.cli); });
    document.getElementById("visitasStatsGrid").innerHTML =
      card("Clientes visitados no período", fmtInt(clientesVisitados.size), "clientes distintos com visita realizada, conforme filtros atuais");
  }

  // ---------------- clientes visitados por cidade ----------------
  function renderCidades(visits) {
    var by = {};
    visits.forEach(function (v) {
      if (!v.r || v.cli == null) return;
      var k = v.ci || "Não informada";
      if (!by[k]) by[k] = new Set();
      by[k].add(v.cli);
    });
    var arr = Object.keys(by).map(function (k) { return { name: k, v: by[k].size }; })
      .sort(function (a, b) { return b.v - a.v; });
    renderRank("rankCidades", arr, function (a) { return fmtInt(a.v); }, arr.length ? arr[0].v : 1, "Sem visitas realizadas no período selecionado.");
  }

  function renderReasons(visits) {
    var c = {};
    visits.forEach(function (v) { if (!v.r && v.rz) c[v.rz] = (c[v.rz] || 0) + 1; });
    var tot = Object.keys(c).reduce(function (a, k) { return a + c[k]; }, 0);
    var arr = Object.keys(c).map(function (k) { return { name: k, v: c[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    renderRank("rankReasons", arr, function (a) { return fmtInt(a.v) + "<small>" + fmtPct(a.v / tot * 100) + "</small>"; }, arr.length ? arr[0].v : 1, "Sem justificativas no período selecionado.");
  }

  function renderWorst(visits) {
    var b = {};
    visits.forEach(function (v) { if (!b[v.v]) b[v.v] = { p: 0, r: 0 }; b[v.v].p++; if (v.r) b[v.v].r++; });
    var arr = Object.keys(b).filter(function (k) { return b[k].p >= 3; }).map(function (k) {
      return { name: k, v: b[k].r / b[k].p * 100, p: b[k].p, r: b[k].r };
    }).sort(function (a, c) { return a.v - c.v || c.p - a.p; }).slice(0, 10);
    renderRank("rankWorst", arr, function (a) { return fmtPct(a.v) + "<small>" + a.r + "/" + a.p + "</small>"; }, 100, "Sem dados suficientes no período selecionado.");
  }

  // ---------------- gráfico: desempenho por gerente (barras horizontais) ----------------
  function renderGerentes(visits) {
    var painel = document.getElementById("panelGerentes");
    if (state.gerente) { painel.style.display = "none"; return; }
    var b = {};
    visits.forEach(function (v) { if (!v.g) return; if (!b[v.g]) b[v.g] = { p: 0, r: 0 }; b[v.g].p++; if (v.r) b[v.g].r++; });
    var arr = Object.keys(b).map(function (g) { return { name: g, p: b[g].p, r: b[g].r, pct: b[g].p ? b[g].r / b[g].p * 100 : 0 }; })
      .sort(function (a, c) { return c.pct - a.pct; });
    painel.style.display = "";
    var svg = document.getElementById("chartGerentes");
    var W = document.getElementById("chartGerentesBox").clientWidth || 500;
    var rowH = 32, padL = 130, padR = 46, padT = 8, padB = 22;
    var H = padT + padB + Math.max(1, arr.length) * rowH;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("height", H);
    if (!arr.length) {
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="' + css("--text-mute") + '" font-size="13">Sem visitas no período selecionado</text>';
      return;
    }
    var gw = W - padL - padR;
    var x = function (pct) { return padL + gw * Math.min(pct, 100) / 100; };
    var svgParts = [];
    [0, 25, 50, 75, 100].forEach(function (g) {
      svgParts.push('<line class="bar-h-grid" x1="' + x(g) + '" x2="' + x(g) + '" y1="' + padT + '" y2="' + (H - padB) + '"></line>');
      svgParts.push('<text class="bar-h-axis" x="' + x(g) + '" y="' + (H - padB + 14) + '" text-anchor="middle">' + g + "%</text>");
    });
    arr.forEach(function (a, i) {
      var cy = padT + i * rowH + rowH / 2;
      var color = a.pct >= 80 ? css("--good") : a.pct >= 50 ? css("--warn") : css("--bad");
      svgParts.push('<text class="bar-h-name" x="' + (padL - 10) + '" y="' + (cy + 4) + '" text-anchor="end">' + esc(shortName(a.name)) + "</text>");
      svgParts.push('<rect x="' + padL + '" y="' + (cy - 8) + '" width="' + gw + '" height="16" rx="4" fill="' + css("--card2") + '"></rect>');
      svgParts.push('<rect x="' + padL + '" y="' + (cy - 8) + '" width="' + Math.max(0, x(a.pct) - padL) + '" height="16" rx="4" fill="' + color + '"></rect>');
      svgParts.push('<text class="bar-h-val" x="' + (x(a.pct) + 8) + '" y="' + (cy + 4) + '">' + fmtPct(a.pct) + "</text>");
    });
    svg.innerHTML = svgParts.join("");
  }

  // ---------------- gráfico: barras (planejadas) + linha (realizadas) ----------------
  var chartDays = [];
  function renderChart(visits) {
    var by = {};
    visits.forEach(function (v) { if (!by[v.d]) by[v.d] = { p: 0, r: 0 }; by[v.d].p++; if (v.r) by[v.d].r++; });
    var days = Object.keys(by).sort();
    chartDays = days.map(function (d) { return { d: d, p: by[d].p, r: by[d].r }; });
    var svg = document.getElementById("chart");
    var W = document.getElementById("chartBox").clientWidth || 900, H = 280;
    var padL = 8, padR = 8, padT = 22, padB = 30, ch = H - padT - padB;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!days.length) { svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="' + css("--text-mute") + '" font-size="13">Sem visitas no período selecionado</text>'; return; }
    var max = Math.max.apply(null, chartDays.map(function (x) { return x.p; }).concat([1]));
    var gw = (W - padL - padR) / days.length;
    var bw = Math.max(6, Math.min(34, gw * 0.56));
    var y = function (v) { return padT + ch - (v / max) * ch; };
    var cx = function (i) { return padL + gw * i + gw / 2; };
    var cBar = css("--s-bar"), cLine = css("--s-line"), cMute = css("--text-mute"), cCard = css("--card"), cBorder = css("--border"), cText = css("--text-dim");
    var out = [];
    // linha de base apenas (sem linhas de grade)
    out.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + ch) + '" y2="' + (padT + ch) + '" stroke="' + cBorder + '" stroke-width="1"/>');
    // barras com topo arredondado (4px) ancoradas na base
    chartDays.forEach(function (x, i) {
      var h = Math.max(1, (x.p / max) * ch), x0 = cx(i) - bw / 2, y0 = padT + ch - h, r = Math.min(4, bw / 2, h);
      out.push('<path d="M' + x0 + "," + (padT + ch) + "V" + (y0 + r) + "Q" + x0 + "," + y0 + " " + (x0 + r) + "," + y0 + "H" + (x0 + bw - r) + "Q" + (x0 + bw) + "," + y0 + " " + (x0 + bw) + "," + (y0 + r) + "V" + (padT + ch) + 'Z" fill="' + cBar + '"/>');
    });
    // linha de realizadas
    var pts = chartDays.map(function (x, i) { return cx(i) + "," + y(x.r); }).join(" ");
    out.push('<polyline points="' + pts + '" fill="none" stroke="' + cLine + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
    chartDays.forEach(function (x, i) {
      out.push('<circle cx="' + cx(i) + '" cy="' + y(x.r) + '" r="4.5" fill="' + cLine + '" stroke="' + cCard + '" stroke-width="2"/>');
    });
    // rótulos do eixo x
    var step = Math.ceil(days.length / Math.max(1, Math.floor(W / 56)));
    chartDays.forEach(function (x, i) {
      if (i % step === 0) out.push('<text x="' + cx(i) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11.5" fill="' + cMute + '">' + x.d.slice(8, 10) + "/" + x.d.slice(5, 7) + "</text>");
    });
    // rótulo direto: pico de planejadas e último ponto da linha
    var last = chartDays.length - 1;
    out.push('<text x="' + cx(last) + '" y="' + (y(chartDays[last].r) - 10) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + cText + '">' + chartDays[last].r + "</text>");
    // camada de hover
    out.push('<rect id="hoverBand" x="0" y="' + padT + '" width="' + gw + '" height="' + ch + '" fill="' + cMute + '" opacity="0" rx="6"/>');
    chartDays.forEach(function (x, i) {
      out.push('<rect class="hit" data-i="' + i + '" x="' + (padL + gw * i) + '" y="0" width="' + gw + '" height="' + H + '" fill="transparent"/>');
    });
    svg.innerHTML = out.join("");
    var band = document.getElementById("hoverBand"), tip = document.getElementById("tooltip"), box = document.getElementById("chartBox");
    svg.querySelectorAll(".hit").forEach(function (r) {
      r.addEventListener("mousemove", function (e) {
        var i = +r.getAttribute("data-i"), x = chartDays[i];
        band.setAttribute("x", padL + gw * i); band.setAttribute("opacity", "0.10");
        var wd = new Date(x.d + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short" });
        tip.innerHTML = '<div class="t-title">' + dBR(x.d) + " (" + wd + ")</div>" +
          '<div class="t-row"><span><i class="lg-bar"></i>Planejadas</span><b>' + fmtInt(x.p) + "</b></div>" +
          '<div class="t-row"><span><i class="lg-line"></i>Realizadas</span><b>' + fmtInt(x.r) + "</b></div>" +
          '<div class="t-row"><span>Cumprimento</span><b>' + fmtPct(x.p ? x.r / x.p * 100 : 0) + "</b></div>";
        var rect = box.getBoundingClientRect();
        var left = e.clientX - rect.left + 14, top = e.clientY - rect.top - 10;
        if (left + 190 > rect.width) left = e.clientX - rect.left - 200;
        tip.style.left = left + "px"; tip.style.top = Math.max(0, top) + "px"; tip.style.opacity = 1;
      });
      r.addEventListener("mouseleave", function () { band.setAttribute("opacity", "0"); tip.style.opacity = 0; });
    });
  }

  // ---------------- tabela ----------------
  var lastTable = { rows: [], visits: [] };
  function renderTable(visits, sales) {
    var b = {};
    var visitados = {}; // vc -> Set de cli visitados (clientes roteirizados de fato)
    visits.forEach(function (v) {
      if (!b[v.v]) b[v.v] = { v: v.v, g: v.g, vc: v.vc, p: 0, r: 0, j: 0, cv: 0, val: 0, fora: 0, nfora: 0 };
      var x = b[v.v]; x.p++; if (v.r) { x.r++; if (v.cv) x.cv++; } if (v.j) x.j++;
      if (v.vc != null && v.cli != null) {
        var k = String(v.vc);
        if (!visitados[k]) visitados[k] = new Set();
        visitados[k].add(v.cli);
      }
    });
    var temFr = !DATA.sales_legacy;
    sales.forEach(function (s) {
      var m = META[String(s.vc)]; if (!m || !b[m.nome]) return;
      b[m.nome].val += s.val; if (temFr && s.fr === 1) { b[m.nome].fora += s.val; b[m.nome].nfora += s.np; }
    });
    // clientes distintos na carteira do vendedor (total ativo)
    var cTotais = {};
    filteredCarteira().forEach(function (c) {
      var k = String(c.vc);
      cTotais[k] = (cTotais[k] || 0) + 1;
    });
    var rows = Object.keys(b).map(function (k) {
      var x = b[k];
      x.pct = x.p ? x.r / x.p * 100 : 0; x.conv = x.r ? x.cv / x.r * 100 : 0; x.pfora = x.val ? x.fora / x.val * 100 : 0;
      x.cTotal = cTotais[String(x.vc)] || 0;
      x.cVisit = (visitados[String(x.vc)] || new Set()).size;
      return x;
    });
    var q = (document.getElementById("tableSearch").value || "").toLowerCase();
    if (q) rows = rows.filter(function (r) { return r.v.toLowerCase().indexOf(q) !== -1 || (r.g || "").toLowerCase().indexOf(q) !== -1; });
    rows.sort(function (a, c) {
      var k = sortState.key, d = sortState.dir === "asc" ? 1 : -1;
      return (typeof a[k] === "string" ? a[k].localeCompare(c[k], "pt-BR") : a[k] - c[k]) * d;
    });
    lastTable = { rows: rows, visits: visits };
    document.querySelectorAll("#tableWrap thead th").forEach(function (th) {
      var on = th.getAttribute("data-key") === sortState.key;
      th.classList.toggle("sorted", on); th.classList.toggle("asc", on && sortState.dir === "asc");
    });
    function tag(v, g, w) { return '<span class="tag ' + (v >= g ? "good" : v >= w ? "warn" : "bad") + '">' + fmtPct(v) + "</span>"; }
    var convDisponivel = DATA.conversao_disponivel !== false;
    document.getElementById("tableBody").innerHTML = rows.length ? rows.map(function (r) {
      return "<tr><td class='txt'>" + esc(r.v) + "</td><td class='txt'>" + '<span title="' + esc(r.g) + '">' + esc(shortName(r.g)) + "</span>" + "</td><td>" + fmtInt(r.p) + "</td><td>" + fmtInt(r.r) +
        "</td><td>" + fmtInt(r.j) + "</td><td>" + tag(r.pct, 80, 50) + "</td><td>" + fmtMoney(r.val) + "</td><td>" + (temFr ? fmtMoney(r.fora) : "—") +
        "</td><td>" + (temFr ? fmtPct(r.pfora) : "—") + "</td><td>" + (temFr ? fmtInt(r.nfora) : "—") + "</td><td>" + (convDisponivel ? tag(r.conv, 30, 10) : "—") + "</td><td>" + fmtInt(r.cTotal) +
        "</td><td>" + fmtInt(r.cVisit) + "</td></tr>";
    }).join("") : '<tr><td colspan="13"><div class="empty-state">Nenhum vendedor encontrado com os filtros atuais.</div></td></tr>';
    // limita a área visível a 10 vendedores (o restante fica na rolagem, via CSS)
    var wrap = document.getElementById("tableWrap");
    wrap.style.maxHeight = wrap.querySelectorAll("tbody tr").length > 10 ? "" : "none";
    document.getElementById("tableCount").textContent = rows.length + " vendedor(es) · role a tabela para ver todos";
  }


  // ---------------- exportação: Excel (.xlsx gerado sem bibliotecas externas) ----------------
  var CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) { // files: [{name, data(string)}] -> Uint8Array (zip sem compressão)
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var lh = [0x50, 0x4B, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += lh.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var h = [0x50, 0x4B, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      parts.push(new Uint8Array(h), c.name); cdSize += h.length + c.name.length;
    });
    parts.push(new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }
  function xmlEsc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
  function colLetter(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // estilos: 0 padrão · 1 cabeçalho · 2 inteiro · 3 percentual · 4 moeda · 5 data · 6 decimal(1)
  var X_INT = 2, X_PCT = 3, X_MONEY = 4, X_DATE = 5, X_DEC = 6;
  function sheetXml(header, rows, widths, freezeCols) {
    var x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
    x.push('<sheetViews><sheetView workbookViewId="0"><pane' + (freezeCols ? ' xSplit="' + freezeCols + '"' : "") + ' ySplit="1" topLeftCell="' + colLetter(freezeCols || 0) + '2" activePane="' + (freezeCols ? "bottomRight" : "bottomLeft") + '" state="frozen"/></sheetView></sheetViews>');
    x.push('<sheetFormatPr defaultRowHeight="15"/><cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("") + "</cols><sheetData>");
    x.push('<row r="1" ht="32" customHeight="1">' + header.map(function (h, i) { return '<c r="' + colLetter(i) + '1" s="1" t="inlineStr"><is><t>' + xmlEsc(h) + "</t></is></c>"; }).join("") + "</row>");
    rows.forEach(function (r, ri) {
      var n = ri + 2;
      x.push('<row r="' + n + '">' + r.map(function (cell, ci) {
        var ref = colLetter(ci) + n;
        if (cell == null || cell === "") return "";
        if (typeof cell === "object") return '<c r="' + ref + '" s="' + cell.s + '"><v>' + cell.v + "</v></c>";
        if (typeof cell === "number") return '<c r="' + ref + '"><v>' + cell + "</v></c>";
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + "</t></is></c>";
      }).join("") + "</row>");
    });
    x.push("</sheetData>");
    if (rows.length) x.push('<autoFilter ref="A1:' + colLetter(header.length - 1) + (rows.length + 1) + '"/>');
    x.push("</worksheet>");
    return x.join("");
  }
  function buildXlsx(sheets) {
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (sh, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (sh, i) { return '<sheet name="' + xmlEsc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets></workbook>";
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (sh, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3A4FD6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    var files = [{ name: "[Content_Types].xml", data: ct }, { name: "_rels/.rels", data: rels }, { name: "xl/workbook.xml", data: wb },
      { name: "xl/_rels/workbook.xml.rels", data: wbRels }, { name: "xl/styles.xml", data: styles }];
    sheets.forEach(function (sh, i) { files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: sheetXml(sh.header, sh.rows, sh.widths, sh.freezeCols) }); });
    return zipStore(files);
  }
  function num(v, s) { return { s: s, v: v }; }
  function isoSerial(iso) { var p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569; }
  function sufixoArquivo() {
    if (state.dataIni && state.dataIni === state.dataFim) return state.dataIni.split("-").reverse().join("-");
    if (state.dataIni || state.dataFim) return (state.dataIni || "inicio").split("-").reverse().join("-") + "_a_" + (state.dataFim || "fim").split("-").reverse().join("-");
    return "todo_periodo";
  }
  function baixar(blob, nome) {
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function exportExcel() {
    var rows = lastTable.rows, visits = lastTable.visits;
    if (!rows.length) { alert("Não há dados para exportar com os filtros atuais."); return; }
    var temFr = !DATA.sales_legacy, convOk = DATA.conversao_disponivel !== false;
    // aba 1: visão resumida (mesmas colunas e ordem da tabela)
    var resumo = rows.map(function (r) {
      return [r.v, r.g || "", num(r.p, X_INT), num(r.r, X_INT), num(r.j, X_INT), num(r.pct / 100, X_PCT), num(Math.round(r.val * 100) / 100, X_MONEY),
        temFr ? num(Math.round(r.fora * 100) / 100, X_MONEY) : "", temFr ? num(r.pfora / 100, X_PCT) : "", temFr ? num(r.nfora, X_INT) : "",
        convOk ? num(r.conv / 100, X_PCT) : "", num(r.cTotal, X_INT), num(r.cVisit, X_INT)];
    });
    // aba 2: roteiro do dia (visitas planejadas dos vendedores exibidos na tabela, conforme filtros)
    var nomes = {}; rows.forEach(function (r) { nomes[r.v] = true; });
    var vis = visits.filter(function (v) { return nomes[v.v]; }).sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.v || "").localeCompare(b.v || "", "pt-BR") || nomeCliente(a.cli).localeCompare(nomeCliente(b.cli), "pt-BR");
    });
    var DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
    var roteiro = vis.map(function (v) {
      var wd = DIAS[new Date(v.d + "T00:00:00Z").getUTCDay()];
      return [num(isoSerial(v.d), X_DATE), wd, v.ca || "", v.g || "", v.v || "", v.cli == null ? "" : num(v.cli, 0), v.cli == null ? "" : nomeCliente(v.cli), v.ci || "",
        v.r ? "Realizada" : "Não realizada", v.j ? "Sim" : "Não", v.r ? "" : (v.rz || ""),
        v.s > 0 ? num(Math.round(v.s / 6) / 10, X_DEC) : "", v.r && convOk ? (v.cv ? "Sim" : "Não") : ""];
    });
    var xlsx = buildXlsx([
      { name: "Visão resumida", freezeCols: 2, widths: [32, 22, 12, 12, 14, 14, 18, 18, 14, 16, 13, 16, 16],
        header: ["Vendedor", "Gerente", "Planejadas", "Realizadas", "Justificativas", "% Cumprimento", "Valor vendido", "Venda fora roteiro", "% Fora roteiro", "Pedidos fora de rota", "% Conversão", "Clientes em carteira", "Clientes roteirizados"], rows: resumo },
      { name: "Roteiro do dia", freezeCols: 0, widths: [12, 15, 12, 24, 32, 12, 42, 22, 15, 12, 30, 14, 14],
        header: ["Data", "Dia da semana", "Canal", "Gerente", "Vendedor", "Cód. cliente", "Cliente", "Cidade", "Status da visita", "Justificada", "Razão (não visitou)", "Tempo em loja (min)", "Gerou pedido"], rows: roteiro }
    ]);
    baixar(new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "visao_por_vendedor_" + sufixoArquivo() + ".xlsx");
  }

  // ---------------- exportação: imagem PNG da tabela completa (sem rolagem) ----------------
  var COPY_PROPS = ["display", "box-sizing", "width", "height", "min-width", "max-width", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-bottom", "color", "background-color", "font-family", "font-size", "font-weight", "font-variant-numeric", "line-height", "text-align", "text-transform",
    "letter-spacing", "white-space", "vertical-align", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "border-collapse", "border-spacing", "box-shadow"];
  function inlineStyles(src, dst) {
    var cs = getComputedStyle(src), st = "";
    COPY_PROPS.forEach(function (p) { st += p + ":" + cs.getPropertyValue(p) + ";"; });
    dst.setAttribute("style", st);
    for (var i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
  }
  function exportImagem() {
    var btn = document.getElementById("btnExportImg"), label = btn.innerHTML;
    var table = document.querySelector("#tableWrap table");
    if (!lastTable.rows.length) { alert("Não há dados para exportar com os filtros atuais."); return; }
    btn.disabled = true; btn.textContent = "Gerando imagem…";
    setTimeout(function () {
      try {
        var W = table.offsetWidth;
        var clone = table.cloneNode(true);
        inlineStyles(table, clone);
        // na imagem nada é congelado/sticky; a tabela sai inteira
        clone.querySelectorAll("th, td").forEach(function (c) { c.style.position = "static"; c.style.boxShadow = "none"; });
        clone.style.width = W + "px"; clone.style.minWidth = W + "px";
        var cardBg = css("--card"), text = css("--text"), mute = css("--text-mute"), border = css("--border");
        var wrap = document.createElement("div");
        wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        wrap.setAttribute("style", "box-sizing:border-box;width:" + (W + 48) + "px;padding:24px;background:" + cardBg + ";font-family:'Segoe UI',Arial,sans-serif;color:" + text + ";");
        var filtros = document.getElementById("filterNote").textContent;
        var cab = document.createElement("div");
        cab.setAttribute("style", "margin-bottom:14px;");
        cab.innerHTML = '<div style="font-size:18px;font-weight:700;color:' + text + ';">Visão geral por vendedor — ' + esc(document.getElementById("channelLabel").textContent) + "</div>" +
          '<div style="font-size:12.5px;color:' + mute + ';margin-top:4px;">' + esc(filtros) + " · " + lastTable.rows.length + " vendedor(es)</div>" +
          '<div style="font-size:12px;color:' + mute + ';margin-top:2px;">' + esc(document.getElementById("updatedAt").textContent) + "</div>";
        var box = document.createElement("div");
        box.setAttribute("style", "border:1px solid " + border + ";border-radius:12px;overflow:hidden;");
        box.appendChild(clone); wrap.appendChild(cab); wrap.appendChild(box);
        // mede a altura real num container fora da tela
        var stage = document.createElement("div");
        stage.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;";
        stage.appendChild(wrap); document.body.appendChild(stage);
        var H = wrap.offsetHeight, Wf = wrap.offsetWidth;
        var xhtml = new XMLSerializer().serializeToString(wrap);
        document.body.removeChild(stage);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Wf + '" height="' + H + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xhtml + "</foreignObject></svg>";
        var scale = Math.min(2, 16000 / H, 16000 / Wf);
        var img = new Image();
        img.onload = function () {
          try {
            var cv = document.createElement("canvas");
            cv.width = Math.round(Wf * scale); cv.height = Math.round(H * scale);
            var ctx = cv.getContext("2d");
            ctx.fillStyle = cardBg; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
            cv.toBlob(function (b) {
              btn.disabled = false; btn.innerHTML = label;
              if (!b) { alert("Não foi possível gerar a imagem (tabela muito grande). Filtre por gerente e tente novamente."); return; }
              baixar(b, "visao_por_vendedor_" + sufixoArquivo() + ".png");
            }, "image/png");
          } catch (e) { btn.disabled = false; btn.innerHTML = label; alert("Não foi possível gerar a imagem neste navegador."); }
        };
        img.onerror = function () { btn.disabled = false; btn.innerHTML = label; alert("Não foi possível gerar a imagem neste navegador."); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      } catch (e) { btn.disabled = false; btn.innerHTML = label; alert("Erro ao gerar a imagem: " + e.message); }
    }, 30);
  }

  function renderNote() {
    var p = [];
    if (state.gerente) p.push("Gerente: <b>" + esc(state.gerente) + "</b>");
    if (state.vendedor) p.push("Vendedor: <b>" + esc(state.vendedor) + "</b>");
    if (state.cidade) p.push("Cidade: <b>" + esc(state.cidade) + "</b>");
    if (state.mes) p.push("Mês: <b>" + MESES[parseInt(state.mes.split("-")[1], 10)] + "</b>");
    if (state.dataIni && state.dataIni === state.dataFim) p.push("Data da visita: <b>" + dBR(state.dataIni) + "</b>");
    else if (state.dataIni || state.dataFim) p.push("Período: <b>" + (dBR(state.dataIni) || "início") + " a " + (dBR(state.dataFim) || "fim") + "</b>");
    document.getElementById("filterNote").innerHTML = p.length ? "Filtros ativos — " + p.join(" · ") : "Nenhum filtro aplicado — exibindo todo o período disponível.";
  }

  function renderAll() {
    var visits = filteredVisits(), sales = filteredSales();
    renderKPIs(visits); renderChart(visits); renderReasons(visits);
    renderVisitasStats(visits); renderCidades(visits);
    // ranking de pior desempenho não faz sentido com um único vendedor já selecionado
    var showWorst = !state.vendedor;
    document.getElementById("panelWorst").style.display = showWorst ? "" : "none";
    document.getElementById("rowVisitas").classList.toggle("grid-2--single", !showWorst);
    document.getElementById("titleReasons").textContent = showWorst ? "Top 5 justificativas mais recorrentes" : "Justificativas mais recorrentes";
    if (showWorst) renderWorst(visits);
    renderGerentes(visits);
    document.getElementById("rowKpiExtra").style.display = document.getElementById("panelGerentes").style.display === "none" ? "none" : "";
    renderSales(sales); renderCarteira(visits); renderTable(visits, sales); renderForaCarteira(sales); renderNote();
  }

  // ---------------- canal / tema ----------------
  // logo dos canais (Alimentar/Exclusiva) no modo escuro usa a versão branca da logo demonstrativa
  // (a versão colorida perde contraste no fundo escuro); no modo claro usa a logo colorida normalmente.
  function logoFor(c, theme) {
    if (c !== "geral" && theme === "dark" && window.LOGOS_ESCURO && window.LOGOS_ESCURO[c]) return window.LOGOS_ESCURO[c];
    return window.LOGOS[c];
  }
  function setCanal(c) {
    state.canal = c; state.gerente = ""; state.vendedor = "";
    document.documentElement.setAttribute("data-canal", c);
    document.querySelectorAll(".canal-pill").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-canal") === c); });
    document.getElementById("brandLogo").src = logoFor(c, document.documentElement.getAttribute("data-theme"));
    document.getElementById("channelLabel").textContent = c === "geral" ? "Visão geral (Alimentar + Exclusiva)" : "Canal " + CANAL_MAP[c];
    refreshFilterOptions(); renderAll();
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.getElementById("themeToggle").innerHTML = t === "dark" ? "☀️ Modo claro" : "🌙 Modo escuro";
    document.getElementById("brandLogo").src = logoFor(state.canal, t);
    try { localStorage.setItem("dashboard_demo_theme", t); } catch (e) {}
  }

  // ---------------- páginas ----------------
  function setPage(p) {
    document.querySelectorAll(".page").forEach(function (el) { el.classList.toggle("active", el.getAttribute("data-page") === p); });
    document.querySelectorAll(".side-nav-btn").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-page") === p); });
    // os gráficos usam a largura do container: recalcula ao trocar de página (a página anterior fica display:none)
    if (p === "visitas") renderChart(filteredVisits());
    if (p === "kpi") renderGerentes(filteredVisits());
  }

  // dia anterior à data de atualização (DATA.gerado_em = "dd/mm/aaaa hh:mm"); fallback: último dia da base
  function diaAnteriorAtualizacao() {
    var iso = null;
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(DATA.gerado_em || "");
    if (m) iso = m[3] + "-" + m[2] + "-" + m[1];
    else if (DATA.periodo && DATA.periodo.max) return DATA.periodo.max;
    if (!iso) return "";
    var t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  }

  function init() {
    var meta = DATA.gerado_em ? "Atualizado em " + DATA.gerado_em : "";
    if (DATA.periodo && DATA.periodo.min) meta += " · Dados de " + dBR(DATA.periodo.min) + " a " + dBR(DATA.periodo.max);
    document.getElementById("updatedAt").textContent = meta;
    document.querySelectorAll(".jr").forEach(function (e) { e.textContent = DATA.janela_rota_dias || 2; });
    document.getElementById("footerNote").innerHTML =
      "Visita <b>realizada</b>: tempo em loja executado maior que " + (DATA.min_minutos_visita || 15) + " minutos. " +
      "Cruzamento entre as bases pelo <b>código do cliente</b> (último código da coluna Ponto de Venda do sistema de rotas × Cód. Cliente da venda ingressada × Cliente da venda faturada). " +
      "Visita <b>convertida</b>: o mesmo vendedor tem pedido para o mesmo cliente em até " + (DATA.janela_conversao_dias || 2) + " dias da visita. " +
      "Venda <b>fora do roteiro</b>: pedido de cliente sem visita planejada do vendedor em até " + (DATA.janela_rota_dias || 2) + " dias da data do pedido. " +
      "Valores de venda ingressada consideram apenas pedidos do tipo VENDAS (exclui bonificações). " +
      (DATA.faturado_legacy
        ? "Venda faturada atribuída, por aproximação, ao vendedor que mais visita o cliente no canal (a base de faturamento não traz o vendedor). "
        : "Venda faturada considera apenas notas do tipo V (exclui devolução, bonificação e troca) e usa o vendedor e a data reais da nota fiscal. ") +
      (DATA.sales_legacy
        ? "Venda ingressada atribuída, por aproximação, ao vendedor que mais visita o cliente no canal (a base atual de venda ingressada não traz vendedor, data nem número do pedido por linha) — por isso a classificação em rota × fora do roteiro e a conversão de vendas não estão disponíveis para a venda ingressada neste período. "
        : "") +
      "Carteira: considera apenas clientes ativos das abas Equipe Alimentar e Equipe Exclusiva; cliente <b>sem roteiro</b> é aquele cujo vendedor responsável não tem nenhuma visita planejada a ele no sistema de rotas dentro do período/filtro selecionado.";

    var tSaved = null; try { tSaved = localStorage.getItem("dashboard_demo_theme"); } catch (e) {}
    setTheme(tSaved || "dark");
    document.getElementById("themeToggle").addEventListener("click", function () {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
      renderChart(filteredVisits()); renderGerentes(filteredVisits());
    });
    document.querySelectorAll(".canal-pill").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-canal");
        setCanal(state.canal === c ? "geral" : c);
      });
    });
    var map = { fGerente: "gerente", fVendedor: "vendedor", fCidade: "cidade", fMes: "mes" };
    Object.keys(map).forEach(function (id) {
      document.getElementById(id).addEventListener("change", function (e) {
        state[map[id]] = e.target.value;
        if (id === "fGerente") { state.vendedor = ""; refreshFilterOptions(); }
        renderAll();
      });
    });
    document.getElementById("fDataIni").addEventListener("change", function (e) { state.dataIni = e.target.value; renderAll(); });
    document.getElementById("fDataFim").addEventListener("change", function (e) { state.dataFim = e.target.value; renderAll(); });
    document.getElementById("btnClear").addEventListener("click", function () {
      state.gerente = state.vendedor = state.cidade = state.mes = state.dataIni = state.dataFim = "";
      document.getElementById("fDataIni").value = ""; document.getElementById("fDataFim").value = "";
      refreshFilterOptions(); renderAll();
    });
    document.getElementById("tableSearch").addEventListener("input", function () { renderTable(filteredVisits(), filteredSales()); });
    document.getElementById("carteiraSearch").addEventListener("input", function () { renderCarteiraTable(); });
    document.getElementById("foraCarteiraSearch").addEventListener("input", function () { renderForaCarteiraTable(); });
    document.querySelectorAll(".side-nav-btn").forEach(function (b) { b.addEventListener("click", function () { setPage(b.getAttribute("data-page")); }); });
    document.querySelectorAll("#tableWrap thead th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-key");
        if (sortState.key === k) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        else { sortState.key = k; sortState.dir = (k === "v" || k === "g") ? "asc" : "desc"; }
        renderTable(filteredVisits(), filteredSales());
      });
    });
    var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { renderChart(filteredVisits()); renderGerentes(filteredVisits()); }, 120); });
    document.getElementById("btnExportXlsx").addEventListener("click", exportExcel);
    document.getElementById("btnExportImg").addEventListener("click", exportImagem);
    // ao abrir, já vem filtrado o dia anterior ao da atualização
    var ontem = diaAnteriorAtualizacao();
    if (ontem) {
      state.dataIni = state.dataFim = ontem;
      document.getElementById("fDataIni").value = ontem; document.getElementById("fDataFim").value = ontem;
    }
    setCanal("geral");
  }
  document.addEventListener("DOMContentLoaded", init);
})();
