let rawData = { devices: [], rentalOrders: [], income: [], expense: [], loans: [], customers: [], badDebts: [] };
let data = { devices: [], rentalOrders: [], income: [], expense: [], loans: [], customers: [], badDebts: [] };
let rentLedgerFilter = "all";
const financePageSize = 50;
let financePages = { income: 1, expense: 1 };

const money = (value) => `¥${Math.round(Number(value || 0)).toLocaleString("zh-CN")}`;
const componentFields = [
  ["cpu", "CPU", "compCpu"],
  ["motherboard", "主板", "compMotherboard"],
  ["memory", "内存", "compMemory"],
  ["storage", "硬盘", "compStorage"],
  ["gpu", "显卡", "compGpu"],
  ["cooler", "散热器", "compCooler"],
  ["psu", "电源", "compPsu"],
  ["case", "机箱", "compCase"]
];

function deviceSortValue(code = "") {
  const text = String(code);
  const match = text.match(/AW-(\d+)(.*)/i);
  if (!match) return { n: Number.MAX_SAFE_INTEGER, suffix: text };
  return { n: Number(match[1]), suffix: match[2] || "" };
}

function compareDeviceCode(a = "", b = "") {
  const left = deviceSortValue(a);
  const right = deviceSortValue(b);
  if (left.n !== right.n) return left.n - right.n;
  return left.suffix.localeCompare(right.suffix, "zh-CN", { numeric: true });
}

function includesKeyword(row, keyword) {
  if (!keyword) return true;
  return JSON.stringify(row).toLowerCase().includes(keyword);
}

function hasRealDeviceContent(device) {
  return Boolean(
    device.code
      && (
        device.status
        || device.spec
        || Number(device.cost || 0) > 0
        || Number(device.rent || 0) > 0
        || Number(device.collected || 0) > 0
      )
  );
}

function hasRealRentalContent(order) {
  return Boolean(
    order.status
      && (
        order.deviceCode
        || order.customer
        || order.model
        || Number(order.monthlyRent || 0) > 0
        || Number(order.collected || 0) > 0
      )
  );
}

function normalizeData(source) {
  const devices = (source.devices || [])
    .filter(hasRealDeviceContent)
    .sort((a, b) => compareDeviceCode(a.code, b.code));

  const rentalOrders = (source.rentalOrders || [])
    .filter(hasRealRentalContent)
    .sort((a, b) => compareDeviceCode(a.deviceCode, b.deviceCode) || Number(a.row || 0) - Number(b.row || 0));

  const validDeviceCodes = new Set(devices.map((device) => device.code));
  const currentByCode = new Map();
  rentalOrders
    .filter((order) => order.status === "租赁中" && validDeviceCodes.has(order.deviceCode))
    .forEach((order) => currentByCode.set(order.deviceCode, order));

  devices.forEach((device) => {
    const order = currentByCode.get(device.code);
    if (order && !device.status) device.status = "在租";
    if (order && !device.currentCustomer) device.currentCustomer = order.customer;
  });

  return {
    meta: source.meta || {},
    devices,
    rentalOrders,
    income: (source.income || []).filter((row) => row.date || row.category || Number(row.amount || 0) > 0 || row.summary),
    expense: (source.expense || []).filter((row) => row.date || row.category || Number(row.amount || 0) > 0 || row.summary),
    loans: (source.loans || []).filter((row) => row.name || Number(row.principal || 0) > 0),
    customers: source.customers || [],
    badDebts: source.badDebts || []
  };
}

async function loadData() {
  if (window.location.protocol === "file:") {
    document.querySelector("#storageStatus").textContent = "请双击 启动经营系统.bat 打开";
    throw new Error("Direct file open cannot load data. Use 启动经营系统.bat.");
  }
  const response = await fetch(`api/data?t=${Date.now()}`, { cache: "no-store" });
  rawData = await response.json();
  rawData.badDebts = rawData.badDebts || [];
  data = normalizeData(rawData);
  document.querySelector("#storageStatus").textContent = "business-dashboard-data.json";
  renderAll();
}

function byDeviceCode() {
  return Object.fromEntries(data.devices.map((device) => [device.code, device]));
}

function isBadDebtOrder(order) {
  return order.status === "坏单" || customerKey(order.customer) === "张欣";
}

function currentOrders() {
  return data.rentalOrders
    .filter((order) => order.status === "租赁中" && !isBadDebtOrder(order))
    .sort((a, b) => compareDeviceCode(a.deviceCode, b.deviceCode));
}

function historyOrders() {
  return data.rentalOrders
    .filter((order) => order.status && order.status !== "租赁中" && order.status !== "已买断" && order.status !== "坏单")
    .sort((a, b) => compareDeviceCode(a.deviceCode, b.deviceCode) || Number(a.row || 0) - Number(b.row || 0));
}

function buyoutRows() {
  const orderRows = data.rentalOrders
    .filter((order) => order.status === "已买断")
    .map((order) => ({ type: "order", ...order }));
  const deviceRows = data.devices
    .filter((device) => device.status === "买断")
    .map((device) => ({ type: "device", ...device }));
  const merged = new Map();
  deviceRows.forEach((device) => {
    const code = device.code || device.id;
    merged.set(code, { ...device, source: "设备主表" });
  });
  orderRows.forEach((order) => {
    const code = order.deviceCode;
    const existing = merged.get(code) || {};
    merged.set(code, {
      ...existing,
      ...order,
      code,
      deviceCode: code,
      source: existing.source ? "租赁+设备" : "租赁统计",
      cost: Number(existing.cost || order.cost || 0),
      collected: Math.max(Number(existing.collected || 0), Number(order.collected || 0)),
      spec: existing.spec || order.model,
      paybackProgress: existing.paybackProgress || (order.cost ? `${Math.round(Number(order.collected || 0) / Number(order.cost || 1) * 100)}%` : "")
    });
  });
  return Array.from(merged.values()).sort((a, b) => compareDeviceCode(a.deviceCode || a.code, b.deviceCode || b.code));
}

function statusChip(status) {
  const text = status || "未标记";
  let tone = "";
  if (String(text).includes("租")) tone = "good";
  if (String(text).includes("买断") || String(text).includes("已回本")) tone = "good";
  if (String(text).includes("空置") || String(text).includes("未回本")) tone = "warning";
  if (String(text).includes("丢失") || String(text).includes("异常") || String(text).includes("坏单")) tone = "danger";
  return `<span class="chip ${tone}">${text}</span>`;
}

function formatSpec(spec = "") {
  const text = String(spec || "").trim();
  if (!text) return "-";
  const normalized = text
    .replace(/\s+(主板[:：])/g, "\n$1")
    .replace(/\s+(内存[:：])/g, "\n$1")
    .replace(/\s+(硬盘[:：])/g, "\n$1")
    .replace(/\s+(显卡[:：])/g, "\n$1")
    .replace(/\s+(散热器[:：])/g, "\n$1")
    .replace(/\s+(电源[:：])/g, "\n$1")
    .replace(/\s+(机箱[:：])/g, "\n$1")
    .replace(/\s+(显示器[:：])/g, "\n$1");
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<span class="rented-spec-line">${line}</span>`)
    .join("");
}

function deviceCollectedFromOrders(deviceCode) {
  return data.rentalOrders
    .filter((order) => order.deviceCode === deviceCode)
    .reduce((sum, order) => sum + Number(order.collected || 0), 0);
}

function parseLocalDate(text) {
  if (!text) return null;
  const normalized = String(text).replace(/\//g, "-");
  const parts = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!parts) return null;
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

function formatDate(date) {
  if (!date) return "-";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextRentDate(contractDateText, fromDate = new Date()) {
  const contractDate = parseLocalDate(contractDateText);
  if (!contractDate) return null;
  const day = contractDate.getDate();
  const base = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  let candidate = new Date(base.getFullYear(), base.getMonth(), Math.min(day, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
  if (candidate < base) {
    candidate = new Date(base.getFullYear(), base.getMonth() + 1, Math.min(day, new Date(base.getFullYear(), base.getMonth() + 2, 0).getDate()));
  }
  return candidate;
}

function daysUntil(date) {
  if (!date) return null;
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date - base) / 86400000);
}

function isCurrentMonthDate(text, base = new Date()) {
  const date = parseLocalDate(text);
  return Boolean(date && date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth());
}

function withinDays(date, days) {
  if (!date) return false;
  const today = todayDateOnly();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return date >= today && date <= end;
}

function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sameMonth(date, base = new Date()) {
  return date && date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth();
}

function isRentalIncome(row) {
  const text = `${row.category || ""} ${row.summary || ""}`;
  return text.includes("租赁") || text.includes("租金") || text.includes("月租");
}

function currentMonthRentalIncomeRows() {
  return data.income.filter((row) => isCurrentMonthDate(row.date) && isRentalIncome(row));
}

function currentMonthRentalIncomeTotal() {
  return currentMonthRentalIncomeRows().reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function monthStart(offset = 0, base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth() + offset, 1);
}

function monthLabel(date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

function sameYearMonthFromText(text, date) {
  const parsed = parseLocalDate(text);
  return Boolean(parsed && parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth());
}

function rentalIncomeForMonth(date) {
  return data.income
    .filter((row) => sameYearMonthFromText(row.date, date) && isRentalIncome(row))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function actualIncomeForMonth(date) {
  return data.income
    .filter((row) => sameYearMonthFromText(row.date, date))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function actualExpenseForMonth(date) {
  return data.expense
    .filter((row) => sameYearMonthFromText(row.date, date))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function activeLoans() {
  return data.loans.filter((row) => Number(row.remainingPrincipal || 0) > 0);
}

function repaymentType(loan) {
  const name = String(loan.name || "");
  const category = String(loan.category || "");
  if (loan.repaymentType) return loan.repaymentType;
  if (category === "个人" && name === "陈晓玲") return "flexible";
  if (category === "个人" && name === "信用卡" && Number(loan.remainingPrincipal || 0) === 4000) return "short_term";
  if (category === "贷款" && name === "招商银行" && Number(loan.principal || 0) >= 100000) return "interest_only";
  return "installment";
}

function effectiveLoanMonthlyPayment(loan) {
  const type = repaymentType(loan);
  if (type === "flexible" || type === "short_term") return 0;
  if (type === "interest_only") return Number(loan.monthlyInterest || loan.interestMonthly || 0);
  return Number(loan.monthlyPayment || 0);
}

function repaymentTypeLabel(loan) {
  const type = repaymentType(loan);
  if (type === "flexible") return "灵活归还";
  if (type === "short_term") return "短期待还";
  if (type === "interest_only") return "先息后本";
  return "分期月供";
}

function loanPaymentForOffset(loan, offset) {
  const monthly = effectiveLoanMonthlyPayment(loan);
  const remaining = Number(loan.remainingPrincipal || 0);
  if (!monthly || !remaining) return 0;
  if (repaymentType(loan) === "interest_only") return monthly;
  const beforeMonth = Math.max(remaining - monthly * offset, 0);
  return Math.min(monthly, beforeMonth);
}

function loanRemainingAfterOffset(loan, offset) {
  const monthly = effectiveLoanMonthlyPayment(loan);
  const remaining = Number(loan.remainingPrincipal || 0);
  if (!monthly || repaymentType(loan) !== "installment") return remaining;
  return Math.max(remaining - monthly * (offset + 1), 0);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function financeMonthPlan(monthCount = 6) {
  const currentRent = currentOrders().reduce((sum, order) => sum + Number(order.monthlyRent || 0), 0);
  const loans = activeLoans();
  return Array.from({ length: monthCount }, (_, offset) => {
    const month = monthStart(offset);
    const paidRent = offset === 0 ? rentalIncomeForMonth(month) : 0;
    const expectedRent = currentRent;
    const unpaidRent = Math.max(expectedRent - paidRent, 0);
    const loanPayment = loans.reduce((sum, loan) => sum + loanPaymentForOffset(loan, offset), 0);
    const remainingPrincipal = loans.reduce((sum, loan) => sum + loanRemainingAfterOffset(loan, offset), 0);
    const actualIncome = offset === 0 ? actualIncomeForMonth(month) : 0;
    const actualExpense = offset === 0 ? actualExpenseForMonth(month) : 0;
    const fullBalance = expectedRent - loanPayment;
    const paidBalance = paidRent - loanPayment;
    return {
      month,
      expectedRent,
      paidRent,
      unpaidRent,
      loanPayment,
      remainingPrincipal,
      actualIncome,
      actualExpense,
      fullBalance,
      paidBalance
    };
  });
}

function toneForAmount(value) {
  if (Number(value || 0) < 0) return "danger";
  if (Number(value || 0) === 0) return "warning";
  return "good";
}

function orderDueDate(order) {
  return parseLocalDate(order.nextRentDate) || nextRentDate(order.contractDate || order.startDate);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function rentLedgerRows() {
  const today = todayDateOnly();
  const monthEnd = endOfMonth(today);
  return currentOrders().map((order) => {
    const dueDate = orderDueDate(order);
    const left = dueDate ? Math.round((dueDate - today) / 86400000) : null;
    const lastPaidDate = parseLocalDate(order.lastRentPaidDate);
    const coversThisMonth = Boolean(dueDate && dueDate > monthEnd);
    let status = coversThisMonth ? "本月已收" : "未到期";
    let tone = coversThisMonth ? "good" : "neutral";
    let priority = coversThisMonth ? 4 : 3;
    let action = dueDate ? (coversThisMonth ? `下次 ${formatDate(dueDate)}` : `${left}天后收租`) : "缺少合同日期";

    if (!coversThisMonth && left < 0) {
      status = "逾期未收";
      tone = "danger";
      priority = 0;
      action = `已逾期 ${Math.abs(left)} 天`;
    } else if (!coversThisMonth && left === 0) {
      status = "今天应收";
      tone = "warning";
      priority = 1;
      action = "今天需要收款";
    } else if (!coversThisMonth && left === 1) {
      status = "明天应收";
      tone = "warning";
      priority = 2;
      action = "明天收款";
    }

    return {
      order,
      dueDate,
      lastPaidDate,
      status,
      tone,
      priority,
      action
    };
  }).sort((a, b) => a.priority - b.priority || compareDeviceCode(a.order.deviceCode, b.order.deviceCode));
}

function splitSpecLines(text = "") {
  return String(text || "")
    .replace(/\s+(主板[:：])/g, "\n$1")
    .replace(/\s+(内存[:：])/g, "\n$1")
    .replace(/\s+(硬盘[:：])/g, "\n$1")
    .replace(/\s+(显卡[:：])/g, "\n$1")
    .replace(/\s+(散热器[:：])/g, "\n$1")
    .replace(/\s+(电源[:：])/g, "\n$1")
    .replace(/\s+(机箱[:：])/g, "\n$1")
    .replace(/\s+(显示器[:：])/g, "\n$1")
    .split(/\n+/);
}

function parseComponents(spec = "") {
  const result = {};
  splitSpecLines(spec).forEach((line) => {
    const text = line.trim();
    if (/^CPU[:：]/i.test(text)) result.cpu = text.replace(/^CPU[:：]\s*/i, "");
    if (/^主板[:：]/.test(text)) result.motherboard = text.replace(/^主板[:：]\s*/, "");
    if (/^内存[:：]/.test(text)) result.memory = text.replace(/^内存[:：]\s*/, "");
    if (/^硬盘[:：]/.test(text)) result.storage = text.replace(/^硬盘[:：]\s*/, "");
    if (/^显卡[:：]/.test(text)) result.gpu = text.replace(/^显卡[:：]\s*/, "");
    if (/^散热器[:：]/.test(text)) result.cooler = text.replace(/^散热器[:：]\s*/, "");
    if (/^电源[:：]/.test(text)) result.psu = text.replace(/^电源[:：]\s*/, "");
    if (/^机箱[:：]/.test(text)) result.case = text.replace(/^机箱[:：]\s*/, "");
  });
  return result;
}

function componentsFromForm(form) {
  return Object.fromEntries(componentFields.map(([key, , inputName]) => [key, form.elements[inputName]?.value?.trim() || ""]));
}

function fillComponentFields(form, components = {}, fallbackSpec = "") {
  const parsed = { ...parseComponents(fallbackSpec), ...(components || {}) };
  componentFields.forEach(([key, , inputName]) => {
    if (form.elements[inputName]) form.elements[inputName].value = parsed[key] || "";
  });
}

function componentsToSpec(components = {}, fallback = "") {
  const lines = componentFields
    .map(([key, label]) => [label, components[key]])
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label}：${value}`);
  const extra = String(fallback || "").trim();
  return extra ? [...lines, extra].join(" ") : lines.join(" ");
}

function formatSpec(spec = "") {
  if (typeof spec === "object" && spec) {
    const lines = componentFields
      .map(([key, label]) => [label, spec[key]])
      .filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `<span class="rented-spec-line"><b>${label}：</b>${value}</span>`);
    return lines.join("") || "-";
  }
  return splitSpecLines(spec)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<span class="rented-spec-line">${line}</span>`)
    .join("") || "-";
}

async function persistData() {
  const response = await fetch("api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rawData)
  });
  if (!response.ok) throw new Error("保存失败");
  data = normalizeData(rawData);
  renderAll();
}

function nextRentalId() {
  return `rent-${Date.now()}`;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function findRawOrder(id) {
  return rawData.rentalOrders.find((order) => order.id === id);
}

function findRawDevice(code) {
  return rawData.devices.find((device) => device.code === code);
}

function nextDeviceCode() {
  const numbers = (rawData.devices || [])
    .map((device) => String(device.code || "").match(/^AW-(\d+)$/i))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number));
  const next = numbers.length ? Math.max(...numbers) + 1 : 2025001;
  return `AW-${next}`;
}

function customerKey(name = "") {
  return String(name || "").trim();
}

function zhangXinOrders() {
  return data.rentalOrders.filter((order) => customerKey(order.customer) === "张欣");
}

function zhangXinRawOrders() {
  return rawData.rentalOrders.filter((order) => customerKey(order.customer) === "张欣");
}

function defaultZhangXinBreakdown() {
  return [
    {
      config: "14600KF+5060",
      quantity: 30,
      monthlyRent: 500,
      buyoutAmount: 3500,
      twelveMonthRent: 180000,
      buyoutTotal: 105000
    },
    {
      config: "U7-265K+5060",
      quantity: 10,
      monthlyRent: 700,
      buyoutAmount: 5500,
      twelveMonthRent: 84000,
      buyoutTotal: 55000
    }
  ];
}

function badDebtLineTotal(row) {
  return Number(row.twelveMonthRent || 0) + Number(row.buyoutTotal || 0);
}

function getZhangXinBadDebt() {
  rawData.badDebts = rawData.badDebts || [];
  const existing = rawData.badDebts.find((item) => customerKey(item.customer) === "张欣");
  if (existing) {
    existing.breakdown = existing.breakdown || defaultZhangXinBreakdown();
    return existing;
  }
  const order = zhangXinRawOrders()[0] || {};
  const breakdown = defaultZhangXinBreakdown();
  return {
    id: "bad-debt-zhangxin",
    customer: "张欣",
    rentalOrderId: order.id || "",
    breakdown,
    contractAmount: breakdown.reduce((sum, row) => sum + badDebtLineTotal(row), 0),
    costAmount: 250000,
    collectedAmount: 107900,
    caseStatus: "已起诉",
    caseDate: "",
    nextDeadline: "",
    nextAction: "跟进起诉进度，整理合同、聊天记录、转账记录和设备交付证据",
    note: order.note || "",
    updatedAt: ""
  };
}

function findCustomerProfile(name) {
  const key = customerKey(name);
  if (!key) return null;
  rawData.customers = rawData.customers || [];
  return rawData.customers.find((customer) => customerKey(customer.name) === key) || null;
}

function findOrdersByCustomer(name) {
  const key = customerKey(name);
  return rawData.rentalOrders.filter((order) => customerKey(order.customer) === key);
}

function updateDevicePayback(device) {
  const cost = Number(device.cost || 0);
  const collected = Number(device.collected || 0);
  const progress = cost ? (collected / cost) * 100 : 0;
  device.paybackProgress = cost ? `${progress.toFixed(2)}%` : "";
  device.paidBack = progress >= 100 ? "是" : "否";
}

function openRentalForm(orderId = "") {
  const form = document.querySelector("#rentalForm");
  form.reset();
  document.querySelector("#rentalModalTitle").textContent = orderId ? "编辑租约" : "新增租约";
  const order = orderId ? findRawOrder(orderId) : null;
  if (order) {
    Object.entries(order).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value ?? "";
    });
    fillComponentFields(form, order.components, order.model);
    if (form.elements.contractDate) form.elements.contractDate.value = order.contractDate || order.startDate || "";
  } else {
    if (form.elements.contractDate) form.elements.contractDate.value = todayText();
    if (form.elements.startDate) form.elements.startDate.value = todayText();
  }
  document.querySelector("#rentalModal").showModal();
}

function openDeviceForm(code = "") {
  const form = document.querySelector("#deviceForm");
  form.reset();
  const device = code ? findRawDevice(code) : null;
  document.querySelector("#deviceModalTitle").textContent = device ? "编辑设备" : "新增空置设备";
  form.elements.code.value = device?.code || "";
  form.elements.codeDisplay.value = device?.code || nextDeviceCode();
  form.elements.codeDisplay.readOnly = Boolean(device);
  form.elements.status.value = device?.status || "空置";
  form.elements.cost.value = device?.cost ?? "";
  form.elements.rent.value = device?.rent ?? "";
  form.elements.collected.value = device?.collected ?? 0;
  form.elements.rentedMonths.value = device?.rentedMonths ?? 0;
  form.elements.depositFree.value = device?.depositFree || "否";
  form.elements.paidBack.value = device?.paidBack || "否";
  form.elements.spec.value = device?.spec || "";
  fillComponentFields(form, device?.components || {}, device?.spec || "");
  document.querySelector("#deviceModal").showModal();
}

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function openReturnForm(orderId) {
  const order = findRawOrder(orderId);
  if (!order) return;
  const form = document.querySelector("#returnForm");
  form.reset();
  form.elements.id.value = order.id;
  form.elements.deviceCode.value = order.deviceCode || "";
  form.elements.customer.value = order.customer || "";
  form.elements.collected.value = Number(order.collected || 0);
  form.elements.returnDate.value = order.returnDate || todayText();
  form.elements.returnNote.value = order.note || "";
  document.querySelector("#returnModal").showModal();
}

function openFinanceForm(type) {
  const form = document.querySelector("#financeForm");
  form.reset();
  form.elements.type.value = type;
  form.elements.date.value = todayText();
  if (type === "income") {
    document.querySelector("#financeModalTitle").textContent = "新增收入";
    form.elements.category.value = "租赁";
  } else {
    document.querySelector("#financeModalTitle").textContent = "新增支出";
    form.elements.category.value = "进货";
  }
  document.querySelector("#financeModal").showModal();
}

function addMonthsToDate(dateText, months) {
  const date = parseLocalDate(dateText) || new Date();
  const targetDay = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + Number(months || 0), 1);
  result.setDate(Math.min(targetDay, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return formatDate(result);
}

function openCollectRentForm(orderId) {
  const order = findRawOrder(orderId);
  if (!order) return;
  const form = document.querySelector("#collectRentForm");
  form.reset();
  form.elements.id.value = order.id;
  form.elements.deviceCode.value = order.deviceCode || "";
  form.elements.customer.value = order.customer || "";
  form.elements.date.value = todayText();
  form.elements.amount.value = Number(order.monthlyRent || 0);
  form.elements.renewMonths.value = 1;
  form.elements.summary.value = `${order.deviceCode || ""} ${order.customer || ""} 租金`;
  document.querySelector("#collectRentModal").showModal();
}

function setPreview(imgId, value) {
  const img = document.querySelector(`#${imgId}`);
  img.src = value || "";
  img.style.display = value ? "block" : "none";
}

function openCustomerForm(orderId) {
  const order = findRawOrder(orderId);
  if (!order) return;
  const form = document.querySelector("#customerForm");
  form.reset();
  const profile = findCustomerProfile(order.customer) || {};
  form.elements.originalName.value = order.customer || "";
  form.elements.name.value = profile.name || order.customer || "";
  form.elements.phone.value = profile.phone || order.phone || "";
  form.elements.idCard.value = profile.idCard || order.idCard || "";
  form.elements.address.value = profile.address || order.address || order.note || "";
  form.elements.deviceCode.value = order.deviceCode || "";
  form.elements.idFrontData.value = profile.idFrontData || "";
  form.elements.idBackData.value = profile.idBackData || "";
  setPreview("idFrontPreview", profile.idFrontData);
  setPreview("idBackPreview", profile.idBackData);
  document.querySelector("#customerModal").showModal();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function nextFinanceId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function syncRentIncomeToOrderAndDevice(values) {
  if (values.type !== "income") return;
  if (!String(values.category || "").includes("租赁")) return;

  const amount = Number(values.amount || 0);
  const deviceCode = values.deviceCode.trim();
  const customer = values.customer.trim();
  if (!amount) return;

  const order = rawData.rentalOrders.find((item) => {
    const sameDevice = deviceCode && item.deviceCode === deviceCode;
    const sameCustomer = customer && item.customer === customer && item.status === "租赁中";
    return sameDevice || sameCustomer;
  });
  if (order) {
    order.collected = Number(order.collected || 0) + amount;
    order.currentMonths = order.monthlyRent ? (Number(order.collected || 0) / Number(order.monthlyRent || 1)).toFixed(1) : order.currentMonths;
  }

  const finalDeviceCode = deviceCode || order?.deviceCode;
  const device = finalDeviceCode ? findRawDevice(finalDeviceCode) : null;
  if (device) {
    device.collected = Number(device.collected || 0) + amount;
    updateDevicePayback(device);
  }
}

function renderCommandCenter() {
  const rentRows = rentLedgerRows();
  const currentRentTotal = rentRows.reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const confirmedPaid = rentRows
    .filter((row) => row.status === "本月已收")
    .reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const unconfirmedRows = rentRows.filter((row) => row.status !== "本月已收");
  const monthRentPaid = currentMonthRentalIncomeTotal() || confirmedPaid;
  const monthRentUnpaid = unconfirmedRows.reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const next30Rent = rentRows
    .filter((row) => row.status !== "本月已收" && withinDays(row.dueDate, 30))
    .reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const monthIncome = data.income
    .filter((row) => isCurrentMonthDate(row.date))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const monthExpense = data.expense
    .filter((row) => isCurrentMonthDate(row.date))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const monthNet = monthIncome - monthExpense;
  const idleDevices = data.devices.filter((device) => device.status === "空置");
  const badDebtExposure = (data.badDebts || [])
    .reduce((sum, item) => sum + Math.max(Number(item.contractAmount || 0) - Number(item.collectedAmount || 0), 0), 0);
  const activeDebtPayment = data.loans
    .filter((loan) => Number(loan.remainingPrincipal || 0) > 0)
    .reduce((sum, loan) => sum + effectiveLoanMonthlyPayment(loan), 0);
  const overdueRows = rentRows.filter((row) => row.status === "逾期未收");
  const unpaidRate = currentRentTotal ? monthRentUnpaid / currentRentTotal : 0;

  document.querySelector("#commandMonthRentPaid").textContent = money(monthRentPaid);
  document.querySelector("#commandMonthRentText").textContent = `财务流水本月租赁收入 / 月租盘子 ${money(currentRentTotal)}`;
  document.querySelector("#commandMonthRentUnpaid").textContent = money(monthRentUnpaid);
  document.querySelector("#commandUnpaidText").textContent = `${unconfirmedRows.length} 台未确认`;
  document.querySelector("#commandNext30Rent").textContent = money(next30Rent);
  document.querySelector("#commandNext30Text").textContent = "未来30天待收租金";
  document.querySelector("#commandMonthNet").textContent = money(monthNet);
  document.querySelector("#commandMonthNetText").textContent = `收入 ${money(monthIncome)} / 支出 ${money(monthExpense)}`;

  const decisions = [];
  if (monthNet < 0) {
    decisions.push(["现金流优先", `本月现金净流出 ${money(Math.abs(monthNet))}，进货前先确认未来30天应收 ${money(next30Rent)} 能否按时回款。`, "danger"]);
  } else {
    decisions.push(["现金流状态", `本月现金净流入 ${money(monthNet)}，但仍要扣除分期/月供压力 ${money(activeDebtPayment)}。`, "good"]);
  }
  if (unpaidRate > 0.35) {
    decisions.push(["先催收再扩张", `本月剩余未收占月租盘子 ${Math.round(unpaidRate * 100)}%，建议先把未收款压下来再加杠杆。`, "warning"]);
  } else {
    decisions.push(["收租节奏", `本月未收比例 ${Math.round(unpaidRate * 100)}%，目前收租节奏可控。`, "good"]);
  }
  if (idleDevices.length) {
    decisions.push(["空置资产", `当前有 ${idleDevices.length} 台空置，空置成本 ${money(idleDevices.reduce((sum, device) => sum + Number(device.cost || 0), 0))}，优先出租再考虑新增采购。`, "warning"]);
  }
  if (badDebtExposure) {
    decisions.push(["坏单敞口", `坏单未收敞口 ${money(badDebtExposure)}，这部分不要当成可用现金流。`, "danger"]);
  }

  document.querySelector("#ceoDecisionList").innerHTML = decisions.map(([title, body, tone]) => `
    <div class="insight"><div><strong>${title}</strong><p>${body}</p></div><span class="chip ${tone}">${tone === "danger" ? "优先" : "提示"}</span></div>
  `).join("");

  const customerRisk = [];
  overdueRows.forEach((row) => {
    customerRisk.push({
      name: row.order.customer || "未填写客户",
      body: `${row.order.deviceCode || "-"} 逾期未收，应收 ${money(row.order.monthlyRent)}`,
      tone: "danger"
    });
  });
  (data.badDebts || []).forEach((item) => {
    customerRisk.push({
      name: item.customer || "坏单客户",
      body: `坏单敞口 ${money(Math.max(Number(item.contractAmount || 0) - Number(item.collectedAmount || 0), 0))}，状态：${item.caseStatus || "-"}`,
      tone: "danger"
    });
  });
  if (!customerRisk.length) {
    customerRisk.push({ name: "暂无高风险客户", body: "当前没有逾期未收记录，坏单以专项档案单独管理。", tone: "good" });
  }
  document.querySelector("#customerRiskList").innerHTML = customerRisk.slice(0, 8).map((row) => `
    <div class="rank-row"><div><strong>${row.name}</strong><span>${row.body}</span></div><span class="chip ${row.tone}">${row.tone === "danger" ? "风险" : "正常"}</span></div>
  `).join("");
}

function renderOverview() {
  const devices = data.devices;
  const current = currentOrders();
  const history = historyOrders();
  const buyouts = buyoutRows();
  const paidBack = devices.filter((device) => device.paidBack === "是");
  const blanksHidden = (rawData.devices || []).length - data.devices.length + (rawData.rentalOrders || []).length - data.rentalOrders.length;
  const risk = devices.filter((device) => ["丢失", "空置", "坏单"].includes(device.status)).length;
  const currentRent = current.reduce((sum, order) => sum + Number(order.monthlyRent || 0), 0);

  document.querySelector("#deviceTotal").textContent = devices.length;
  document.querySelector("#deviceStatusText").textContent = `${devices.filter((d) => d.status === "在租").length} 台在租 / ${devices.filter((d) => d.status === "空置").length} 台空置 / ${devices.filter((d) => d.status === "坏单").length} 台坏单`;
  document.querySelector("#rentedTotal").textContent = current.length;
  document.querySelector("#rentedRentText").textContent = `当前订单月租合计 ${money(currentRent)}`;
  document.querySelector("#historyTotal").textContent = history.length;
  document.querySelector("#buyoutTotal").textContent = buyouts.length;
  document.querySelector("#paidBackTotal").textContent = paidBack.length;
  document.querySelector("#paybackText").textContent = `回本率 ${devices.length ? Math.round(paidBack.length / devices.length * 100) : 0}%`;
  document.querySelector("#riskTotal").textContent = risk;

  const deviceIncome = devices.reduce((sum, device) => sum + Number(device.collected || 0), 0);
  const deviceCost = devices.reduce((sum, device) => sum + Number(device.cost || 0), 0);
  const notPaidBack = devices.filter((device) => device.paidBack !== "是" && device.status !== "买断");
  const insights = [
    ["已隐藏空白占位行", `自动隐藏 ${blanksHidden} 条空状态、空配置或未标记的占位记录，列表只显示有效经营数据。`, "good"],
    ["设备回本情况", `设备累计已收 ${money(deviceIncome)}，采购成本合计 ${money(deviceCost)}，还有 ${notPaidBack.length} 台未回本。`, notPaidBack.length ? "warning" : "good"],
    ["当前在租配置", `当前租赁中 ${current.length} 条，已按设备编号从小到大排序。`, "good"],
    ["异常优先处理", `当前有 ${risk} 台空置或丢失设备，建议优先处理这些资产。`, risk ? "danger" : "good"]
  ];

  document.querySelector("#insightList").innerHTML = insights.map(([title, body, tone]) => `
    <div class="insight"><div><strong>${title}</strong><p>${body}</p></div><span class="chip ${tone}">${tone === "danger" ? "优先" : "提示"}</span></div>
  `).join("");

  const ranking = Object.values(current.reduce((map, order) => {
    const key = order.customer || "未填写客户";
    const row = map[key] || { customer: key, rent: 0, count: 0 };
    row.rent += Number(order.monthlyRent || 0);
    row.count += 1;
    map[key] = row;
    return map;
  }, {})).sort((a, b) => b.rent - a.rent).slice(0, 12);

  document.querySelector("#customerRanking").innerHTML = ranking.map((row) => `
    <div class="rank-row"><div><strong>${row.customer}</strong><span>${row.count} 台在租</span></div><span class="chip good">${money(row.rent)}/月</span></div>
  `).join("");

  renderCommandCenter();
}

function renderRentReminders() {
  const groups = Object.values(rentLedgerRows()
    .map((row) => ({ order: row.order, status: row.status, date: row.dueDate, left: daysUntil(row.dueDate) }))
    .filter((item) => item.date)
    .reduce((map, item) => {
      const key = item.order.customer || "未填写客户";
      map[key] = map[key] || { customer: key, orders: [], rent: 0, left: item.left, date: item.date };
      map[key].orders.push(item);
      map[key].rent += Number(item.order.monthlyRent || 0);
      if (item.left < map[key].left) {
        map[key].left = item.left;
        map[key].date = item.date;
      }
      return map;
    }, {}))
    .sort((a, b) => a.left - b.left || b.rent - a.rent)
    .slice(0, 8);

  document.querySelector("#rentReminderList").innerHTML = groups.map((group) => {
    const { left, date } = group;
    const firstOrder = group.orders.sort((a, b) => a.left - b.left)[0]?.order;
    let tone = "good";
    let label = `${left}天后`;
    if (left < 0) {
      tone = "danger";
      label = `逾期${Math.abs(left)}天`;
    } else if (left === 0) {
      tone = "warning";
      label = "今天收租";
    } else if (left === 1) {
      tone = "warning";
      label = "明天收租";
    }
    const statusText = group.orders
      .filter((item) => item.left <= 1)
      .map((item) => item.order.deviceCode)
      .filter(Boolean)
      .slice(0, 4)
      .join("、");
    const moreText = group.orders.length > 4 ? ` 等 ${group.orders.length} 台` : ` ${group.orders.length} 台`;
    return `
      <div class="reminder-row">
        <div>
          <strong>${group.customer} · ${money(group.rent)}</strong>
          <span>${statusText || "待跟进设备"}${moreText}，最近收租日：${formatDate(date)}</span>
        </div>
        <div class="reminder-actions">
          <span class="chip ${tone}">${label}</span>
          <button class="mini-button" type="button" data-collect-rent="${firstOrder?.id || ""}">收款</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="reminder-row"><div><strong>暂无提醒</strong><span>录入合同签订日期后，系统会自动计算收租日。</span></div></div>`;
}

function renderRentLedger() {
  const keyword = document.querySelector("#rentLedgerSearch").value.trim().toLowerCase();
  const allRows = rentLedgerRows();
  const rows = allRows.filter(({ order, status }) => includesKeyword({ ...order, status }, keyword));
  const paid = allRows.filter((row) => row.status === "本月已收");
  const unpaid = allRows.filter((row) => row.status !== "本月已收");
  const idleDevices = data.devices.filter((device) => device.status === "空置");
  const todayRows = allRows.filter((row) => row.status === "今天应收");
  const sumRent = (items) => items.reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const monthRentIncomeRows = currentMonthRentalIncomeRows();
  const monthRentIncome = monthRentIncomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const ledgerUnpaidAmount = sumRent(unpaid);

  document.querySelector("#rentingDeviceCount").textContent = allRows.length;
  document.querySelector("#rentingRentAmount").textContent = `月租合计 ${money(sumRent(allRows))}`;
  document.querySelector("#idleDeviceCount").textContent = idleDevices.length;
  document.querySelector("#idleDeviceCost").textContent = `空置成本 ${money(idleDevices.reduce((sum, device) => sum + Number(device.cost || 0), 0))}`;
  document.querySelector("#rentPaidAmountMain").textContent = money(monthRentIncome || sumRent(paid));
  document.querySelector("#rentPaidCountText").textContent = `${monthRentIncomeRows.length || paid.length} 笔本月租赁收入`;
  document.querySelector("#rentUnpaidAmountMain").textContent = money(ledgerUnpaidAmount);
  document.querySelector("#rentUnpaidCountText").textContent = `${unpaid.length} 台未确认，今天应收 ${todayRows.length} 台`;

  if (rentLedgerFilter === "idle") {
    renderIdleDeviceTable("#rentLedgerTable", idleDevices.filter((device) => includesKeyword(device, keyword)));
    return;
  }

  const filteredRows = rows.filter((row) => {
    if (rentLedgerFilter === "paid") return row.status === "本月已收";
    if (rentLedgerFilter === "unpaid") return row.status !== "本月已收";
    if (rentLedgerFilter === "overdue") return row.status === "逾期未收";
    return true;
  });

  renderRentedTable("#rentLedgerTable", filteredRows.map((row) => row.order));
  document.querySelector("#rentLedgerTable").insertAdjacentHTML("afterbegin", renderRentActionStrip(allRows));
}

function renderRentActionStrip(rows) {
  const urgentRows = rows.filter((row) => row.status === "逾期未收" || row.status === "今天应收");
  const overdueRows = rows.filter((row) => row.status === "逾期未收");
  const todayRows = rows.filter((row) => row.status === "今天应收");
  const urgentRent = urgentRows.reduce((sum, row) => sum + Number(row.order.monthlyRent || 0), 0);
  const firstUrgent = urgentRows[0]?.order;
  return `
    <div class="rent-action-strip">
      <div>
        <span class="label">今日收款作战区</span>
        <strong>${urgentRows.length ? `${urgentRows.length} 台待处理 · ${money(urgentRent)}` : "今天没有紧急收款"}</strong>
        <p>${overdueRows.length} 台逾期未收，${todayRows.length} 台今天应收。优先处理这些设备，再看普通未收款。</p>
      </div>
      <div class="rent-action-strip-actions">
        <button class="primary-button" type="button" ${firstUrgent ? `data-collect-rent="${firstUrgent.id}"` : "disabled"}>处理第一笔</button>
        <button class="ghost-button" type="button" data-rent-filter-shortcut="overdue">只看逾期</button>
        <button class="ghost-button" type="button" data-rent-filter-shortcut="unpaid">只看未收</button>
      </div>
    </div>
  `;
}

function renderRentedTable(targetSelector, rows) {
  const devices = byDeviceCode();
  const ledgerByOrderId = Object.fromEntries(rentLedgerRows().map((row) => [row.order.id, row]));
  document.querySelector(targetSelector).innerHTML = `
    <div class="ledger-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th class="col-index">序号</th>
            <th class="col-status">状态</th>
            <th>设备编号</th>
            <th>客户</th>
            <th>收租状态</th>
            <th>应收日</th>
            <th class="col-spec">配置</th>
            <th>月租</th>
            <th>租赁月数</th>
            <th>租赁期限</th>
            <th>当前已收</th>
            <th>设备历史实收</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((order, index) => {
    const device = devices[order.deviceCode] || {};
    const actualMonths = Number(order.monthlyRent || 0) > 0
      ? Number(order.collected || 0) / Number(order.monthlyRent)
      : 0;
    const deviceCollected = deviceCollectedFromOrders(order.deviceCode);
    const actualMonthText = actualMonths ? `${Math.round(actualMonths)}个月` : "-";
    const ledger = ledgerByOrderId[order.id] || {};
    return `
      <tr>
        <td class="col-index"><span class="row-index">${index + 1}</span></td>
        <td class="col-status">${statusChip(device.status || order.status)}</td>
        <td>
          <strong class="asset-code">${order.deviceCode || "-"}</strong>
        </td>
        <td>
          <button class="customer-link" type="button" data-customer-rental="${order.id}">${order.customer || "未填写"}</button>
          <small>${order.phone || ""}</small>
        </td>
        <td>${statusChip(ledger.status || "-")}</td>
        <td>
          <div class="term-cell">
            <span>${ledger.dueDate ? formatDate(ledger.dueDate) : "-"}</span>
            <span>${ledger.lastPaidDate ? `最近 ${formatDate(ledger.lastPaidDate)}` : "未记录收款"}</span>
            <span>${ledger.action || ""}</span>
          </div>
        </td>
        <td class="col-spec"><div class="rented-spec">${formatSpec(order.components || device.components || order.model || device.spec)}</div></td>
        <td class="money">${money(order.monthlyRent || device.rent)}</td>
        <td><strong>${actualMonthText}</strong></td>
        <td>
          <div class="term-cell">
            <span>${order.startDate || "-"}</span>
            <span>${order.returnDate || "-"}</span>
          </div>
        </td>
        <td class="money">${money(order.collected)}</td>
        <td class="money">${money(deviceCollected)}</td>
        <td>
          <div class="ledger-actions">
            <button class="mini-button" type="button" data-collect-rent="${order.id}">收租/续租</button>
            <button class="mini-button danger" type="button" data-return-rental="${order.id}">退租</button>
            <button class="mini-button" type="button" data-edit-device="${order.deviceCode}">更多</button>
          </div>
        </td>
      </tr>
    `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderIdleDeviceTable(targetSelector, devices) {
  document.querySelector(targetSelector).innerHTML = `
    <div class="ledger-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th class="col-index">序号</th>
            <th class="col-status">状态</th>
            <th>设备编号</th>
            <th class="col-spec">配置</th>
            <th>成本</th>
            <th>建议月租</th>
            <th>累计已收</th>
            <th>回本进度</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${devices.map((device, index) => `
            <tr>
              <td class="col-index"><span class="row-index">${index + 1}</span></td>
              <td class="col-status">${statusChip(device.status || "空置")}</td>
              <td><strong class="asset-code">${device.code || device.id || "-"}</strong></td>
              <td class="col-spec"><div class="rented-spec">${formatSpec(device.components || device.spec)}</div></td>
              <td class="money">${money(device.cost)}</td>
              <td class="money">${money(device.rent)}</td>
              <td class="money">${money(device.collected)}</td>
              <td>${device.paybackProgress || "-"}</td>
              <td>
                <div class="ledger-actions">
                  <button class="mini-button" type="button" data-new-rental-device="${device.code || device.id}">出租</button>
                  <button class="mini-button" type="button" data-edit-device="${device.code || device.id}">编辑</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="9">暂无空置设备</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderRented() {
  const keyword = document.querySelector("#rentedSearch").value.trim().toLowerCase();
  const rows = currentOrders().filter((order) => includesKeyword(order, keyword));
  renderRentedTable("#rentedTable", rows);
}

function renderHistory() {
  const keyword = document.querySelector("#historySearch").value.trim().toLowerCase();
  const rows = historyOrders().filter((order) => includesKeyword(order, keyword));
  document.querySelector("#historyTable").innerHTML = rows.map((order) => `
    <tr>
      <td><strong>${order.deviceCode || "-"}</strong></td>
      <td>${order.customer || "-"}</td>
      <td>${statusChip(order.status)}</td>
      <td>${order.startDate || "-"}</td>
      <td>${order.returnDate || "-"}</td>
      <td class="money">${money(order.monthlyRent)}</td>
      <td class="money">${money(order.collected)}</td>
      <td class="spec-cell">${order.note || order.accessories || "-"}</td>
    </tr>
  `).join("");
}

function renderBuyout() {
  const rows = buyoutRows();
  document.querySelector("#buyoutTable").innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${row.deviceCode || row.code || "-"}</strong><small>${row.source || (row.type === "order" ? "租赁统计表" : "设备主表")}</small></td>
      <td>${row.customer || row.status || "-"}</td>
      <td class="money">${money(row.cost)}</td>
      <td class="money">${money(row.collected)}</td>
      <td>${row.paybackProgress || (row.cost ? `${Math.round(Number(row.collected || 0) / Number(row.cost || 1) * 100)}%` : "-")}</td>
      <td class="spec-cell"><div class="rented-spec">${formatSpec(row.components || row.model || row.spec)}</div></td>
    </tr>
  `).join("");
}

function renderDevices() {
  const keyword = document.querySelector("#deviceSearch").value.trim().toLowerCase();
  const rows = data.devices
    .filter((device) => includesKeyword(device, keyword))
    .sort((a, b) => compareDeviceCode(a.code, b.code));
  document.querySelector("#deviceTable").innerHTML = rows.map((device) => `
    <tr>
      <td><strong>${device.code}</strong></td>
      <td>${statusChip(device.status)}</td>
      <td class="money">${money(device.cost)}</td>
      <td class="money">${money(device.rent)}</td>
      <td>${device.rentedMonths || 0}</td>
      <td class="money">${money(device.collected)}</td>
      <td>${device.paybackProgress || "-"}</td>
      <td>${device.paidBack === "是" ? statusChip("已回本") : statusChip("未回本")}</td>
      <td class="spec-cell"><div class="rented-spec">${formatSpec(device.components || device.spec)}</div></td>
    </tr>
  `).join("");
}

function pagedFinanceRows(rows, type) {
  const totalPages = Math.max(1, Math.ceil(rows.length / financePageSize));
  financePages[type] = Math.min(Math.max(financePages[type] || 1, 1), totalPages);
  const start = (financePages[type] - 1) * financePageSize;
  return {
    page: financePages[type],
    totalPages,
    rows: rows.slice(start, start + financePageSize),
    start,
    end: Math.min(start + financePageSize, rows.length)
  };
}

function renderFinancePagination(selector, type, total, page, totalPages, start, end) {
  const target = document.querySelector(selector);
  if (!target) return;
  const buttons = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    return `<button class="${pageNumber === page ? "active" : ""}" type="button" data-finance-page="${type}" data-page="${pageNumber}">${pageNumber}</button>`;
  }).join("");
  target.innerHTML = `
    <span>第 ${total ? start + 1 : 0}-${end} 条 / 共 ${total} 条</span>
    <div class="pagination-buttons">
      <button type="button" data-finance-page="${type}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
      ${buttons}
      <button type="button" data-finance-page="${type}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function renderFinance() {
  const incomeTotal = data.income.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseTotal = data.expense.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const loanRemain = data.loans.reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  document.querySelector("#incomeTotal").textContent = money(incomeTotal);
  document.querySelector("#expenseTotal").textContent = money(expenseTotal);
  document.querySelector("#netTotal").textContent = money(incomeTotal - expenseTotal);
  document.querySelector("#loanRemainTotal").textContent = money(loanRemain);
  document.querySelector("#incomeCount").textContent = `${data.income.length} 条收入记录`;
  document.querySelector("#expenseCount").textContent = `${data.expense.length} 条支出记录`;
  document.querySelector("#loanCount").textContent = `${data.loans.length} 条贷款/分期`;

  const incomePage = pagedFinanceRows(data.income.slice().reverse(), "income");
  const expensePage = pagedFinanceRows(data.expense.slice().reverse(), "expense");

  document.querySelector("#incomeTable").innerHTML = incomePage.rows.map((row) => `
    <tr><td>${row.date || "-"}</td><td>${row.category || "-"}</td><td class="money">${money(row.amount)}</td><td>${row.customer || "-"}</td><td class="spec-cell">${row.summary || "-"}</td></tr>
  `).join("");
  document.querySelector("#expenseTable").innerHTML = expensePage.rows.map((row) => `
    <tr><td>${row.date || "-"}</td><td>${row.category || "-"}</td><td class="money">${money(row.amount)}</td><td class="spec-cell">${row.summary || "-"}</td></tr>
  `).join("");
  renderFinancePagination("#incomePagination", "income", data.income.length, incomePage.page, incomePage.totalPages, incomePage.start, incomePage.end);
  renderFinancePagination("#expensePagination", "expense", data.expense.length, expensePage.page, expensePage.totalPages, expensePage.start, expensePage.end);
}

function renderBadDebt() {
  const record = getZhangXinBadDebt();
  const orders = zhangXinOrders();
  const contractAmount = Number(record.contractAmount || 0);
  const costAmount = Number(record.costAmount || 0);
  const collectedAmount = Number(record.collectedAmount || 0);
  const exposure = Math.max(contractAmount - collectedAmount, 0);

  document.querySelector("#badDebtStatusChip").textContent = record.caseStatus || "坏单";
  document.querySelector("#badDebtContract").textContent = money(contractAmount);
  document.querySelector("#badDebtCost").textContent = money(costAmount);
  document.querySelector("#badDebtCollected").textContent = money(collectedAmount);
  document.querySelector("#badDebtExposure").textContent = money(exposure);
  document.querySelector("#badDebtBreakdown").innerHTML = (record.breakdown || defaultZhangXinBreakdown()).map((row) => `
    <tr>
      <td><strong>${row.config || "-"}</strong></td>
      <td>${Number(row.quantity || 0).toLocaleString("zh-CN")}</td>
      <td class="money">${money(row.monthlyRent)}</td>
      <td class="money">${money(row.buyoutAmount)}</td>
      <td class="money">${money(row.twelveMonthRent)}</td>
      <td class="money">${money(row.buyoutTotal)}</td>
      <td class="money">${money(badDebtLineTotal(row))}</td>
    </tr>
  `).join("");

  const form = document.querySelector("#badDebtForm");
  if (form && !form.dataset.dirty) {
    form.elements.id.value = record.id || "bad-debt-zhangxin";
    form.elements.customer.value = record.customer || "张欣";
    form.elements.rentalOrderId.value = record.rentalOrderId || orders[0]?.id || "";
    form.elements.contractAmount.value = record.contractAmount ?? "";
    form.elements.costAmount.value = record.costAmount ?? "";
    form.elements.collectedAmount.value = record.collectedAmount ?? "";
    form.elements.caseStatus.value = record.caseStatus || "已起诉";
    form.elements.caseDate.value = record.caseDate || "";
    form.elements.nextDeadline.value = record.nextDeadline || "";
    form.elements.nextAction.value = record.nextAction || "";
    form.elements.note.value = record.note || "";
  }

  document.querySelector("#badDebtLinkedOrders").innerHTML = orders.map((order) => `
    <div class="bad-debt-order">
      <div>
        <strong>${order.deviceCode || "-"}</strong>
        <span>${order.customer || "-"} · ${order.status || "-"} · ${order.startDate || "-"} 至 ${order.returnDate || "-"}</span>
      </div>
      <div class="bad-debt-order-money">
        <span>月租 ${money(order.monthlyRent)}</span>
        <span>订单已收 ${money(order.collected)}</span>
      </div>
    </div>
  `).join("") || `<div class="bad-debt-order"><div><strong>暂无关联订单</strong><span>保存档案后可继续补充关联租约。</span></div></div>`;
}

function renderFinanceHealth() {
  const incomeTotal = data.income.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseTotal = data.expense.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const purchaseExpense = data.expense
    .filter((row) => {
      const category = String(row.category || "");
      return category.includes("\u8fdb\u8d27") || category.includes("\u91c7\u8d2d") || category.includes("杩涜揣");
    })
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const deviceCost = data.devices.reduce((sum, device) => sum + Number(device.cost || 0), 0);
  const loanPrincipal = data.loans.reduce((sum, row) => sum + Number(row.principal || 0), 0);
  const totalInvestment = purchaseExpense;
  const loans = activeLoans();
  const activeLoanPrincipal = loans.reduce((sum, row) => sum + Number(row.principal || 0), 0);
  const loanRemain = loans.reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const monthlyPayment = loans.reduce((sum, row) => sum + effectiveLoanMonthlyPayment(row), 0);
  const currentRent = currentOrders().reduce((sum, order) => sum + Number(order.monthlyRent || 0), 0);
  const monthlyGap = currentRent - monthlyPayment;
  const coverage = monthlyPayment ? currentRent / monthlyPayment : 0;
  const payoffMonths = monthlyPayment ? Math.ceil(loanRemain / monthlyPayment) : 0;
  const zeroPaymentDebt = loans
    .filter((row) => repaymentType(row) === "installment" && Number(row.monthlyPayment || 0) <= 0)
    .reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const flexiblePrincipal = loans
    .filter((row) => repaymentType(row) === "flexible")
    .reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const shortTermPrincipal = loans
    .filter((row) => repaymentType(row) === "short_term")
    .reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const interestOnlyPrincipal = loans
    .filter((row) => repaymentType(row) === "interest_only")
    .reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const interestOnlyMissing = loans
    .filter((row) => repaymentType(row) === "interest_only" && effectiveLoanMonthlyPayment(row) <= 0)
    .reduce((sum, row) => sum + Number(row.remainingPrincipal || 0), 0);
  const monthPlan = financeMonthPlan(6);
  const currentPlan = monthPlan[0] || {};

  document.querySelector("#financeInvestmentTotal").textContent = money(totalInvestment);
  document.querySelector("#financeInvestmentText").textContent = `按进货支出累计，设备成本 ${money(deviceCost)}`;
  document.querySelector("#financeLoanPrincipal").textContent = money(activeLoanPrincipal);
  document.querySelector("#financeLoanRemainText").textContent = `未结清 ${loans.length} 笔，剩余本金 ${money(loanRemain)}`;
  document.querySelector("#financeMonthlyPayment").textContent = money(monthlyPayment);
  document.querySelector("#financePayoffText").textContent = payoffMonths ? `按已录月供约 ${payoffMonths} 个月` : "缺少月供数据";
  document.querySelector("#financeMonthlyGap").textContent = money(monthlyGap);
  document.querySelector("#financeCoverageText").textContent = `月租 ${money(currentRent)} / 覆盖率 ${Math.round(coverage * 100)}%`;
  document.querySelector("#cashflowMonthRent").textContent = money(currentPlan.expectedRent);
  document.querySelector("#cashflowMonthRentText").textContent = `已收 ${money(currentPlan.paidRent)} / 待收 ${money(currentPlan.unpaidRent)}`;
  document.querySelector("#cashflowMonthLoan").textContent = money(currentPlan.loanPayment);
  document.querySelector("#cashflowMonthLoanText").textContent = `未还本金 ${money(loanRemain)}`;
  document.querySelector("#cashflowFullBalance").textContent = money(currentPlan.fullBalance);
  document.querySelector("#cashflowFullBalance").closest(".metric-card").classList.toggle("warning", currentPlan.fullBalance < 0);
  document.querySelector("#cashflowPaidBalance").textContent = money(currentPlan.paidBalance);
  document.querySelector("#cashflowPaidBalanceText").textContent = currentPlan.paidBalance < 0
    ? `按已到账租金仍缺 ${money(Math.abs(currentPlan.paidBalance))}`
    : `按已到账租金结余 ${money(currentPlan.paidBalance)}`;
  document.querySelector("#monthlyCashflowTable").innerHTML = monthPlan.map((row, index) => {
    const balance = index === 0 ? row.fullBalance : row.expectedRent - row.loanPayment;
    const tone = toneForAmount(balance);
    const judgment = balance < 0 ? `缺口 ${money(Math.abs(balance))}` : `结余 ${money(balance)}`;
    return `
      <tr>
        <td><strong>${monthLabel(row.month)}</strong>${index === 0 ? "<span class=\"subline\">本月</span>" : ""}</td>
        <td class="money">${money(row.expectedRent)}</td>
        <td class="money">${index === 0 ? money(row.paidRent) : "-"}</td>
        <td class="money">${index === 0 ? money(row.unpaidRent) : "-"}</td>
        <td class="money">${money(row.loanPayment)}</td>
        <td class="money cashflow-${tone}">${money(balance)}</td>
        <td class="money">${money(row.remainingPrincipal)}</td>
        <td><span class="chip ${tone}">${judgment}</span></td>
      </tr>
    `;
  }).join("");

  const health = [];
  if (monthlyGap < 0) {
    health.push(["现金流缺口", `当前月租盘子 ${money(currentRent)}，已录月供 ${money(monthlyPayment)}，每月缺口 ${money(Math.abs(monthlyGap))}。`, "danger"]);
  } else {
    health.push(["现金流覆盖", `当前月租盘子可覆盖已录月供，月度结余约 ${money(monthlyGap)}。`, "good"]);
  }
  if (zeroPaymentDebt > 0) {
    health.push(["还款计划缺失", `有 ${money(zeroPaymentDebt)} 剩余本金没有录入月供，实际还款压力可能更高。`, "warning"]);
  }
  if (flexiblePrincipal > 0) {
    health.push(["灵活归还款", `陈晓玲灵活归还本金 ${money(flexiblePrincipal)} 不计入固定月供，有钱时归还。`, "good"]);
  }
  if (shortTermPrincipal > 0) {
    health.push(["短期待还款", `近期准备一次性处理的本金 ${money(shortTermPrincipal)} 不按分期月供计算。`, "warning"]);
  }
  if (interestOnlyPrincipal > 0) {
    health.push(["先息后本", `先息后本本金 ${money(interestOnlyPrincipal)} 不按本金月供计算，只计每月利息。`, interestOnlyMissing ? "warning" : "good"]);
  }
  if (interestOnlyMissing > 0) {
    health.push(["利息金额待补", `有 ${money(interestOnlyMissing)} 先息后本本金还没录入每月利息，当前现金流没有把这笔利息算进去。`, "warning"]);
  }
  health.push(["累计净现金", `总收入 ${money(incomeTotal)}，总支出 ${money(expenseTotal)}，累计净额 ${money(incomeTotal - expenseTotal)}。`, incomeTotal >= expenseTotal ? "good" : "warning"]);
  health.push(["贷款进度", `未结清贷款本金 ${money(activeLoanPrincipal)}，当前剩余 ${money(loanRemain)}，已偿还约 ${activeLoanPrincipal ? Math.round((1 - loanRemain / activeLoanPrincipal) * 100) : 0}%。`, "good"]);

  document.querySelector("#financeHealthList").innerHTML = health.map(([title, body, tone]) => `
    <div class="insight"><div><strong>${title}</strong><p>${body}</p></div><span class="chip ${tone}">${tone === "danger" ? "优先" : "提示"}</span></div>
  `).join("");

  document.querySelector("#loanHealthTable").innerHTML = loans
    .sort((a, b) => Number(b.remainingPrincipal || 0) - Number(a.remainingPrincipal || 0))
    .map((loan) => {
      const type = repaymentType(loan);
      const monthly = effectiveLoanMonthlyPayment(loan);
      const remainTerms = type === "installment" && monthly ? Math.ceil(Number(loan.remainingPrincipal || 0) / monthly) : "";
      const paidTerms = Number(loan.paidTerms || 0);
      const totalTerms = Number(loan.terms || 0);
      const payoffDate = type === "flexible"
        ? "有钱时还"
        : type === "short_term"
          ? "近期还清"
        : type === "interest_only"
          ? "先息后本"
          : remainTerms ? monthLabel(addMonths(new Date(), remainTerms - 1)) : "需补充";
      const monthlyText = type === "flexible"
        ? "不计月供"
        : type === "short_term"
          ? "不计月供"
        : type === "interest_only" && !monthly
          ? "利息待补"
          : monthly ? money(monthly) : "未录入";
      return `
        <tr>
          <td>${loan.name || "-"}<small>${repaymentTypeLabel(loan)}</small></td>
          <td class="money">${money(loan.remainingPrincipal)}</td>
          <td class="money">${monthlyText}</td>
          <td>${type === "installment" ? (remainTerms || "需补充") : "-"}</td>
          <td>${paidTerms || 0}${totalTerms ? ` / ${totalTerms}` : ""}</td>
          <td>${payoffDate}</td>
          <td><button class="mini-button" type="button" data-loan-payment="${loan.id}">还款</button></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7">暂无未还贷款</td></tr>`;
}

function renderAll() {
  renderOverview();
  renderRentReminders();
  renderRentLedger();
  renderRented();
  renderHistory();
  renderBuyout();
  renderDevices();
  renderFinance();
  renderFinanceHealth();
  renderBadDebt();
}

async function recordLoanPayment(loanId) {
  const loan = rawData.loans.find((item) => item.id === loanId);
  if (!loan) return;

  const amount = Number(window.prompt(`本次还款总额：${loan.name || ""}`, loan.monthlyPayment || ""));
  if (!amount || amount <= 0) return;

  const interest = Number(window.prompt("其中利息金额（没有就填 0）：", "0") || 0);
  if (interest < 0 || interest > amount) return;

  const principalPaid = Math.min(amount - interest, Number(loan.remainingPrincipal || 0));
  loan.remainingPrincipal = Math.max(Number(loan.remainingPrincipal || 0) - principalPaid, 0);
  loan.repaidPrincipal = Number(loan.repaidPrincipal || 0) + principalPaid;
  loan.paidInterest = Number(loan.paidInterest || 0) + interest;
  loan.paidTerms = Number(loan.paidTerms || 0) + 1;

  rawData.expense = rawData.expense || [];
  rawData.expense.push({
    id: nextFinanceId("exp"),
    row: "",
    date: todayText(),
    category: "贷款还款",
    account: "",
    amount,
    handler: "",
    summary: `${loan.name || "贷款"} 还款，本金 ${principalPaid.toFixed(2)}，利息 ${interest.toFixed(2)}`,
    entryDate: todayText()
  });

  await persistData();
}

function activateView(button) {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  document.querySelector(`#${button.dataset.view}View`).classList.add("active");
  document.querySelector("#pageTitle").textContent = button.dataset.title || button.textContent.trim();
  document.querySelector("#pageEyebrow").textContent = button.dataset.eyebrow || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => activateView(button));
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});

document.querySelector("#rentLedgerFilter").addEventListener("click", (event) => {
  const filter = event.target.dataset.rentFilter;
  if (!filter) return;
  rentLedgerFilter = filter;
  document.querySelectorAll("#rentLedgerFilter button").forEach((button) => {
    button.classList.toggle("active", button.dataset.rentFilter === filter);
  });
  renderRentLedger();
});

document.addEventListener("click", (event) => {
  const shortcut = event.target.closest("[data-rent-filter-shortcut]")?.dataset.rentFilterShortcut;
  if (!shortcut) return;
  rentLedgerFilter = shortcut;
  document.querySelectorAll("#rentLedgerFilter button").forEach((button) => {
    button.classList.toggle("active", button.dataset.rentFilter === shortcut);
  });
  renderRentLedger();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-finance-page]");
  if (!button) return;
  const type = button.dataset.financePage;
  const page = Number(button.dataset.page || 1);
  if (!["income", "expense"].includes(type) || button.disabled) return;
  financePages[type] = page;
  renderFinance();
});

["#rentedSearch", "#historySearch", "#deviceSearch", "#rentLedgerSearch"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", renderAll);
});

document.querySelector("#reloadData").addEventListener("click", loadData);
document.querySelector("#openRentalModal").addEventListener("click", () => openRentalForm());
document.querySelector("#openDeviceModal").addEventListener("click", () => openDeviceForm());
document.querySelector("#openIncomeModal").addEventListener("click", () => openFinanceForm("income"));
document.querySelector("#openExpenseModal").addEventListener("click", () => openFinanceForm("expense"));
document.querySelector("#rentalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  const components = componentsFromForm(form);
  const specText = componentsToSpec(components, values.model);
  const existing = values.id ? findRawOrder(values.id) : null;
  const order = existing || { id: nextRentalId(), row: "", no: "" };
  Object.assign(order, {
    deviceCode: values.deviceCode.trim(),
    customer: values.customer.trim(),
    phone: values.phone.trim(),
    monthlyRent: Number(values.monthlyRent || 0),
    collected: Number(values.collected || 0),
    expectedMonths: values.expectedMonths,
    currentMonths: values.monthlyRent ? (Number(values.collected || 0) / Number(values.monthlyRent || 1)).toFixed(1) : "",
    contractDate: values.contractDate || values.startDate,
    startDate: values.startDate,
    returnDate: values.returnDate,
    status: values.status,
    idCard: values.idCard,
    model: specText,
    components,
    note: values.note
  });
  if (!existing) rawData.rentalOrders.push(order);

  let device = findRawDevice(order.deviceCode);
  if (!device) {
    device = {
      id: order.deviceCode,
      code: order.deviceCode,
      brandModel: "台式机",
      spec: specText,
      components,
      cost: 0,
      bookCost: 0,
      status: order.status === "租赁中" ? "在租" : "",
      depositFree: "否",
      rent: Number(order.monthlyRent || 0),
      rentedMonths: 0,
      collected: 0,
      paybackProgress: "",
      paidBack: "否"
    };
    rawData.devices.push(device);
  }
  if (specText && !device.spec) device.spec = specText;
  device.components = { ...(device.components || {}), ...components };
  device.rent = Number(order.monthlyRent || device.rent || 0);
  if (order.status === "租赁中") device.status = "在租";
  if (order.status === "已买断") device.status = "买断";

  await persistData();
  document.querySelector("#rentalModal").close();
});

document.querySelector("#deviceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  const components = componentsFromForm(form);
  const specText = componentsToSpec(components, values.spec);
  const code = (values.code || values.codeDisplay || "").trim();
  if (!code) {
    window.alert("请填写设备编号");
    return;
  }
  rawData.devices = rawData.devices || [];
  const isNew = !values.code;
  let device = findRawDevice(code);
  if (isNew && device) {
    window.alert(`设备编号 ${code} 已存在`);
    return;
  }
  if (!device) {
    device = {
      id: code,
      code,
      brandModel: "",
      status: "空置",
      collected: 0,
      rentedMonths: 0
    };
    rawData.devices.push(device);
  }
  Object.assign(device, {
    id: device.id || code,
    code,
    status: values.status,
    cost: Number(values.cost || 0),
    bookCost: Number(values.cost || 0),
    rent: Number(values.rent || 0),
    collected: Number(values.collected || 0),
    rentedMonths: Number(values.rentedMonths || 0),
    depositFree: values.depositFree,
    paidBack: values.paidBack,
    components,
    spec: specText
  });
  updateDevicePayback(device);
  await persistData();
  document.querySelector("#deviceModal").close();
});

document.querySelector("#returnForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = formValues(event.currentTarget);
  const order = findRawOrder(values.id);
  if (!order) return;
  order.status = "已归还";
  order.collected = Number(values.collected || 0);
  order.returnDate = values.returnDate;
  order.note = values.returnNote || order.note || "";
  order.currentMonths = order.monthlyRent ? (Number(order.collected || 0) / Number(order.monthlyRent || 1)).toFixed(1) : order.currentMonths;

  const device = findRawDevice(order.deviceCode);
  if (device) {
    device.status = "空置";
    device.currentCustomer = "";
  }

  await persistData();
  document.querySelector("#returnModal").close();
});

document.querySelector("#financeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = formValues(event.currentTarget);
  const amount = Number(values.amount || 0);
  if (values.type === "income") {
    rawData.income.push({
      id: nextFinanceId("inc"),
      row: "",
      date: values.date,
      category: values.category,
      account: values.account,
      amount,
      customer: values.customer,
      summary: values.deviceCode ? `${values.deviceCode} ${values.summary}` : values.summary,
      entryDate: todayText()
    });
    syncRentIncomeToOrderAndDevice(values);
  } else {
    rawData.expense.push({
      id: nextFinanceId("exp"),
      row: "",
      date: values.date,
      category: values.category,
      account: values.account,
      amount,
      handler: "",
      summary: values.deviceCode ? `${values.deviceCode} ${values.summary}` : values.summary,
      entryDate: todayText()
    });
  }

  await persistData();
  document.querySelector("#financeModal").close();
});

document.querySelector("#customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  rawData.customers = rawData.customers || [];

  const originalName = customerKey(values.originalName);
  const newName = customerKey(values.name);
  let profile = findCustomerProfile(originalName) || findCustomerProfile(newName);
  if (!profile) {
    profile = { id: `customer-${Date.now()}` };
    rawData.customers.push(profile);
  }

  const idFrontFile = form.elements.idFront.files[0];
  const idBackFile = form.elements.idBack.files[0];
  const idFrontData = idFrontFile ? await fileToDataUrl(idFrontFile) : values.idFrontData;
  const idBackData = idBackFile ? await fileToDataUrl(idBackFile) : values.idBackData;

  Object.assign(profile, {
    name: newName,
    phone: values.phone,
    idCard: values.idCard,
    address: values.address,
    idFrontData,
    idBackData,
    updatedAt: todayText()
  });

  findOrdersByCustomer(originalName).forEach((order) => {
    order.customer = newName;
    order.phone = values.phone;
    order.idCard = values.idCard;
    order.address = values.address;
  });

  await persistData();
  document.querySelector("#customerModal").close();
});

document.querySelector("#collectRentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = formValues(event.currentTarget);
  const order = findRawOrder(values.id);
  if (!order) return;
  const amount = Number(values.amount || 0);
  const renewMonths = Number(values.renewMonths || 0);

  order.collected = Number(order.collected || 0) + amount;
  order.currentMonths = order.monthlyRent ? (Number(order.collected || 0) / Number(order.monthlyRent || 1)).toFixed(1) : order.currentMonths;
  if (renewMonths > 0) {
    order.returnDate = addMonthsToDate(order.returnDate || order.startDate || values.date, renewMonths);
  }
  const dueForCollection = nextRentDate(order.contractDate || order.startDate);
  const currentDueDate = order.nextRentDate || (dueForCollection ? formatDate(dueForCollection) : values.date);
  order.lastRentPaidDate = values.date;
  order.nextRentDate = addMonthsToDate(currentDueDate, Math.max(renewMonths, 1));

  const device = findRawDevice(order.deviceCode);
  if (device) {
    device.collected = Number(device.collected || 0) + amount;
    device.rentedMonths = Number(device.rentedMonths || 0) + renewMonths;
    updateDevicePayback(device);
  }

  rawData.income.push({
    id: nextFinanceId("inc"),
    row: "",
    date: values.date,
    category: "租赁",
    account: values.account,
    amount,
    customer: order.customer,
    summary: values.summary || `${order.deviceCode} ${order.customer} 租金`,
    entryDate: todayText(),
    deviceCode: order.deviceCode,
    rentalOrderId: order.id
  });

  await persistData();
  document.querySelector("#collectRentModal").close();
});

document.querySelector("#badDebtForm").addEventListener("input", (event) => {
  event.currentTarget.dataset.dirty = "true";
});

document.querySelector("#badDebtForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  rawData.badDebts = rawData.badDebts || [];
  let record = rawData.badDebts.find((item) => item.id === values.id || customerKey(item.customer) === customerKey(values.customer));
  if (!record) {
    record = { id: values.id || `bad-debt-${Date.now()}` };
    rawData.badDebts.push(record);
  }

  Object.assign(record, {
    customer: values.customer || "张欣",
    rentalOrderId: values.rentalOrderId,
    breakdown: record.breakdown || defaultZhangXinBreakdown(),
    contractAmount: Number(values.contractAmount || 0),
    costAmount: Number(values.costAmount || 0),
    collectedAmount: Number(values.collectedAmount || 0),
    caseStatus: values.caseStatus,
    caseDate: values.caseDate,
    nextDeadline: values.nextDeadline,
    nextAction: values.nextAction,
    note: values.note,
    updatedAt: todayText()
  });

  delete form.dataset.dirty;
  await persistData();
});

document.body.addEventListener("click", (event) => {
  const rentalId = event.target.dataset.editRental;
  const deviceCode = event.target.dataset.editDevice;
  const returnRentalId = event.target.dataset.returnRental;
  const customerRentalId = event.target.dataset.customerRental;
  const collectRentId = event.target.dataset.collectRent;
  const newRentalDevice = event.target.dataset.newRentalDevice;
  const loanPaymentId = event.target.dataset.loanPayment;
  if (rentalId) openRentalForm(rentalId);
  if (deviceCode) openDeviceForm(deviceCode);
  if (returnRentalId) openReturnForm(returnRentalId);
  if (customerRentalId) openCustomerForm(customerRentalId);
  if (collectRentId) openCollectRentForm(collectRentId);
  if (loanPaymentId) recordLoanPayment(loanPaymentId);
  if (newRentalDevice) {
    openRentalForm();
    const form = document.querySelector("#rentalForm");
    form.elements.deviceCode.value = newRentalDevice;
    const device = findRawDevice(newRentalDevice);
    if (device) {
      form.elements.monthlyRent.value = Number(device.rent || 0);
      fillComponentFields(form, device.components || {}, device.spec || "");
    }
  }
});

document.querySelector("#exportData").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `电脑租赁经营数据-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

loadData().catch((error) => {
  const status = document.querySelector("#storageStatus");
  status.textContent = window.location.protocol === "file:"
    ? "请通过本地服务打开"
    : "读取失败";
  console.error(error);
});
