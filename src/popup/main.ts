import './style.css';

import {
  RANGE_UNKNOWN,
  SetupType,
  StopType,
  TradeDirection,
  calculateTrade,
  type TradeCalcResponse,
  type TradeInput,
} from '../lib/tradeCalc.js';

type RiskMode = 'risk_cash' | 'risk_percent' | 'notional';

interface StopSettings {
  percent: number | null;
  atrMultiple: number | null;
  points: number | null;
}

interface RiskState {
  mode: RiskMode;
  riskCash: number | null;
  riskPercent: number | null;
  accountSize: number | null;
  notional: number | null;
}

interface InstrumentState {
  symbol: string;
  contractMultiplier: number | null;
  lotStep: number | null;
  minLot: number | null;
  feePerUnit: number | null;
  priceTick: number | null;
}

type SetupToggle = Record<SetupType, boolean>;

interface FormState {
  direction: TradeDirection;
  setups: SetupToggle;
  level: number | null;
  atr: number | null;
  rrMultiple: number | null;
  bufferRatio: number | null;
  rangePassed: number | null;
  currentPrice: number | null;
  enableAtrFilter: boolean;
  stopSettings: StopSettings;
  risk: RiskState;
  instrument: InstrumentState;
}

interface Preset {
  id: string;
  name: string;
  risk: RiskState;
  instrument: InstrumentState;
}

interface FormErrors {
  level?: string;
  atr?: string;
  rrMultiple?: string;
  bufferRatio?: string;
  stopPercent?: string;
  stopAtrMultiple?: string;
  stopPoints?: string;
  setups?: string;
  riskCash?: string;
  riskPercent?: string;
  accountSize?: string;
  notional?: string;
  contractMultiplier?: string;
  lotStep?: string;
  minLot?: string;
  feePerUnit?: string;
}

interface ResultRow {
  id: string;
  setup: SetupType;
  stopType: StopType;
  error?: string;
  response?: TradeCalcResponse;
}

interface ChromeStorageLocal {
  get: (
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void
  ) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
}

interface ChromeLike {
  storage?: {
    local?: ChromeStorageLocal;
  };
}

interface ChromeGlobal {
  chrome?: ChromeLike;
}

const FORM_STORAGE_KEY = 'trade_scope_form_state_v1';
const PRESET_STORAGE_KEY = 'trade_scope_presets_v1';

const STOP_LABELS: Record<StopType, string> = {
  [StopType.FixedPercent]: 'Fixed %',
  [StopType.AtrMultiple]: 'ATR * k',
  [StopType.FixedPoints]: 'Fixed points',
};

const SETUP_LABELS: Record<SetupType, string> = {
  [SetupType.Breakout]: 'Breakout',
  [SetupType.FalseBreakout]: 'False Breakout',
};

const DEFAULT_STATE: FormState = {
  direction: TradeDirection.Long,
  setups: {
    [SetupType.Breakout]: true,
    [SetupType.FalseBreakout]: true,
  },
  level: 100,
  atr: 2,
  rrMultiple: 3,
  bufferRatio: 0.2,
  rangePassed: null,
  currentPrice: null,
  enableAtrFilter: true,
  stopSettings: {
    percent: 0.3,
    atrMultiple: 0.5,
    points: 1,
  },
  risk: {
    mode: 'risk_cash',
    riskCash: 100,
    riskPercent: 1,
    accountSize: 10000,
    notional: 50000,
  },
  instrument: {
    symbol: 'TICKER',
    contractMultiplier: 1,
    lotStep: 1,
    minLot: 1,
    feePerUnit: 0.2,
    priceTick: 0.01,
  },
};

const STORAGE_AVAILABLE = Boolean(
  (globalThis as ChromeGlobal).chrome?.storage?.local
);

const root = document.getElementById('root');

if (!root) {
  throw new Error('Popup root element missing');
}

let formState: FormState = structuredClone(DEFAULT_STATE);
let presets: Preset[] = [];
let formErrors: FormErrors = {};
let selectedPresetId: string | null = null;

const stopTypes: StopType[] = [
  StopType.FixedPercent,
  StopType.AtrMultiple,
  StopType.FixedPoints,
];

const setupOrder: SetupType[] = [SetupType.Breakout, SetupType.FalseBreakout];

let formElement: HTMLFormElement | null = null;
let resultsContainer: HTMLElement | null = null;
let warningsContainer: HTMLElement | null = null;
let summaryContainer: HTMLElement | null = null;
let presetSelect: HTMLSelectElement | null = null;

const debounce = (fn: () => void, delay: number) => {
  let timer: number | undefined;
  return () => {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      fn();
    }, delay);
  };
};

const storageGet = async <T>(key: string): Promise<T | undefined> => {
  if (!STORAGE_AVAILABLE) return undefined;
  const area = (globalThis as ChromeGlobal).chrome!.storage!.local!;
  return new Promise((resolve) => {
    area.get(key, (items) => {
      resolve(items[key] as T | undefined);
    });
  });
};

const storageSet = async (items: Record<string, unknown>): Promise<void> => {
  if (!STORAGE_AVAILABLE) return;
  const area = (globalThis as ChromeGlobal).chrome!.storage!.local!;
  return new Promise((resolve) => {
    area.set(items, () => {
      resolve();
    });
  });
};

const saveStateDebounced = debounce(() => {
  void storageSet({
    [FORM_STORAGE_KEY]: formState,
    [PRESET_STORAGE_KEY]: presets,
  });
}, 400);

const parseNullableNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const formatNumber = (value: number, fractionDigits = 2): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

const formatInteger = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const toBadge = (value: boolean): string => `
  <span class="badge ${value ? 'yes' : 'no'}">${value ? 'Yes' : 'No'}</span>
`;

const loadInitialState = async () => {
  const storedForm = await storageGet<FormState>(FORM_STORAGE_KEY);
  if (storedForm) {
    formState = mergeFormState(storedForm);
  }
  const storedPresets = await storageGet<Preset[]>(PRESET_STORAGE_KEY);
  if (Array.isArray(storedPresets)) {
    presets = storedPresets.map(hydratePreset);
  }
};

const mergeFormState = (incoming: FormState): FormState => {
  const merged: FormState = structuredClone(DEFAULT_STATE);
  merged.direction = incoming.direction ?? DEFAULT_STATE.direction;
  merged.setups = {
    [SetupType.Breakout]: Boolean(
      incoming.setups?.[SetupType.Breakout] ??
        DEFAULT_STATE.setups[SetupType.Breakout]
    ),
    [SetupType.FalseBreakout]: Boolean(
      incoming.setups?.[SetupType.FalseBreakout] ??
        DEFAULT_STATE.setups[SetupType.FalseBreakout]
    ),
  };
  merged.level = normalizeNullable(incoming.level, DEFAULT_STATE.level);
  merged.atr = normalizeNullable(incoming.atr, DEFAULT_STATE.atr);
  merged.rrMultiple = normalizeNullable(
    incoming.rrMultiple,
    DEFAULT_STATE.rrMultiple
  );
  merged.bufferRatio = normalizeNullable(
    incoming.bufferRatio,
    DEFAULT_STATE.bufferRatio
  );
  merged.rangePassed = normalizeNullable(incoming.rangePassed, null);
  merged.currentPrice = normalizeNullable(incoming.currentPrice, null);
  merged.enableAtrFilter = Boolean(
    incoming.enableAtrFilter ?? DEFAULT_STATE.enableAtrFilter
  );
  merged.stopSettings = {
    percent: normalizeNullable(
      incoming.stopSettings?.percent,
      DEFAULT_STATE.stopSettings.percent
    ),
    atrMultiple: normalizeNullable(
      incoming.stopSettings?.atrMultiple,
      DEFAULT_STATE.stopSettings.atrMultiple
    ),
    points: normalizeNullable(
      incoming.stopSettings?.points,
      DEFAULT_STATE.stopSettings.points
    ),
  };
  merged.risk = {
    mode: incoming.risk?.mode ?? DEFAULT_STATE.risk.mode,
    riskCash: normalizeNullable(
      incoming.risk?.riskCash,
      DEFAULT_STATE.risk.riskCash
    ),
    riskPercent: normalizeNullable(
      incoming.risk?.riskPercent,
      DEFAULT_STATE.risk.riskPercent
    ),
    accountSize: normalizeNullable(
      incoming.risk?.accountSize,
      DEFAULT_STATE.risk.accountSize
    ),
    notional: normalizeNullable(
      incoming.risk?.notional,
      DEFAULT_STATE.risk.notional
    ),
  };
  merged.instrument = {
    symbol: incoming.instrument?.symbol ?? DEFAULT_STATE.instrument.symbol,
    contractMultiplier: normalizeNullable(
      incoming.instrument?.contractMultiplier,
      DEFAULT_STATE.instrument.contractMultiplier
    ),
    lotStep: normalizeNullable(
      incoming.instrument?.lotStep,
      DEFAULT_STATE.instrument.lotStep
    ),
    minLot: normalizeNullable(
      incoming.instrument?.minLot,
      DEFAULT_STATE.instrument.minLot
    ),
    feePerUnit: normalizeNullable(
      incoming.instrument?.feePerUnit,
      DEFAULT_STATE.instrument.feePerUnit
    ),
    priceTick: normalizeNullable(
      incoming.instrument?.priceTick,
      DEFAULT_STATE.instrument.priceTick
    ),
  };
  return merged;
};

const hydratePreset = (preset: Preset): Preset => ({
  id: preset.id,
  name: preset.name,
  risk: {
    mode: preset.risk.mode,
    riskCash: normalizeNullable(
      preset.risk.riskCash,
      DEFAULT_STATE.risk.riskCash
    ),
    riskPercent: normalizeNullable(
      preset.risk.riskPercent,
      DEFAULT_STATE.risk.riskPercent
    ),
    accountSize: normalizeNullable(
      preset.risk.accountSize,
      DEFAULT_STATE.risk.accountSize
    ),
    notional: normalizeNullable(
      preset.risk.notional,
      DEFAULT_STATE.risk.notional
    ),
  },
  instrument: {
    symbol: preset.instrument.symbol,
    contractMultiplier: normalizeNullable(
      preset.instrument.contractMultiplier,
      DEFAULT_STATE.instrument.contractMultiplier
    ),
    lotStep: normalizeNullable(
      preset.instrument.lotStep,
      DEFAULT_STATE.instrument.lotStep
    ),
    minLot: normalizeNullable(
      preset.instrument.minLot,
      DEFAULT_STATE.instrument.minLot
    ),
    feePerUnit: normalizeNullable(
      preset.instrument.feePerUnit,
      DEFAULT_STATE.instrument.feePerUnit
    ),
    priceTick: normalizeNullable(
      preset.instrument.priceTick,
      DEFAULT_STATE.instrument.priceTick
    ),
  },
});

const normalizeNullable = (
  value: number | null | undefined,
  fallback: number | null
) => (value === null || value === undefined ? fallback : value);

const renderLayout = () => {
  root.innerHTML = `
    <div class="popup-shell">
      <section class="panel form-panel">
        <h1>Trade Scope</h1>
        <div class="field">
          <label class="field">
            <span class="label">Preset</span>
            <select id="presetSelect">
              <option value="">— Select preset —</option>
            </select>
          </label>
        </div>
        <form id="tradeForm" novalidate>
          <div class="form-block" data-section="trade">
            <h2>Trade Setup</h2>
            <div class="field">
              <label class="field">
                <span class="label">Direction</span>
                <select name="direction">
                  <option value="${TradeDirection.Long}">Long</option>
                  <option value="${TradeDirection.Short}">Short</option>
                </select>
              </label>
            </div>
            <div class="field">
              <span class="label">Setups</span>
              <div class="toggle-group">
                <label class="toggle">
                  <input type="checkbox" name="setup_${SetupType.Breakout}" />
                  <span>Breakout</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" name="setup_${SetupType.FalseBreakout}" />
                  <span>False Breakout</span>
                </label>
              </div>
              <span class="field-error" data-error-for="setups"></span>
            </div>
            <div class="field field-inline">
              <label class="field" data-field="level">
                <span class="label">Level</span>
                <input type="number" name="level" step="0.01" min="0" />
              </label>
              <label class="field" data-field="atr">
                <span class="label">ATR</span>
                <input type="number" name="atr" step="0.01" min="0" />
              </label>
              <label class="field" data-field="rrMultiple">
                <span class="label">RR multiple</span>
                <input type="number" name="rrMultiple" step="0.1" min="0" />
              </label>
            </div>
            <div class="field-error" data-error-for="level"></div>
            <div class="field-error" data-error-for="atr"></div>
            <div class="field-error" data-error-for="rrMultiple"></div>
            <div class="field field-inline">
              <label class="field" data-field="bufferRatio">
                <span class="label">Buffer ratio</span>
                <input type="number" name="bufferRatio" step="0.01" min="0" />
              </label>
              <label class="field">
                <span class="label">Range passed</span>
                <input type="number" name="rangePassed" step="0.01" />
              </label>
              <label class="field">
                <span class="label">Current price</span>
                <input type="number" name="currentPrice" step="0.01" />
              </label>
            </div>
            <div class="field-error" data-error-for="bufferRatio"></div>
          </div>

          <div class="form-block" data-section="stops">
            <h2>Stop settings</h2>
            <div class="field field-inline">
              <label class="field" data-field="stopPercent">
                <span class="label">Fixed %</span>
                <input type="number" name="stop_percent" step="0.01" min="0" />
              </label>
              <label class="field" data-field="stopAtrMultiple">
                <span class="label">ATR * k</span>
                <input type="number" name="stop_atrMultiple" step="0.01" min="0" />
              </label>
              <label class="field" data-field="stopPoints">
                <span class="label">Fixed points</span>
                <input type="number" name="stop_points" step="0.01" min="0" />
              </label>
            </div>
            <div class="field-error" data-error-for="stopPercent"></div>
            <div class="field-error" data-error-for="stopAtrMultiple"></div>
            <div class="field-error" data-error-for="stopPoints"></div>
              <label class="toggle">
                <input type="checkbox" name="enableAtrFilter" />
                <span>Apply "Stop <= 0.2 * ATR" filter</span>
              </label>
          </div>

          <div class="form-block" data-section="risk">
            <h2>Risk model</h2>
            <div class="toggle-group">
              <label class="toggle">
                <input type="radio" name="risk_mode" value="risk_cash" />
                <span>Risk per trade</span>
              </label>
              <label class="toggle">
                <input type="radio" name="risk_mode" value="risk_percent" />
                <span>% of account</span>
              </label>
              <label class="toggle">
                <input type="radio" name="risk_mode" value="notional" />
                <span>Max notional</span>
              </label>
            </div>
            <div class="risk-group" data-risk="risk_cash">
              <label class="field" data-field="riskCash">
                <span class="label">Risk per trade (cash)</span>
                <input type="number" name="risk_cash" step="0.01" min="0" />
              </label>
              <span class="field-error" data-error-for="riskCash"></span>
            </div>
            <div class="risk-group" data-risk="risk_percent">
              <label class="field" data-field="riskPercent">
                <span class="label">Risk %</span>
                <input type="number" name="risk_percent" step="0.01" min="0" />
              </label>
              <label class="field" data-field="accountSize">
                <span class="label">Account size</span>
                <input type="number" name="risk_accountSize" step="0.01" min="0" />
              </label>
              <span class="field-error" data-error-for="riskPercent"></span>
              <span class="field-error" data-error-for="accountSize"></span>
            </div>
            <div class="risk-group" data-risk="notional">
              <label class="field" data-field="notional">
                <span class="label">Max notional</span>
                <input type="number" name="risk_notional" step="0.01" min="0" />
              </label>
              <span class="field-error" data-error-for="notional"></span>
            </div>
          </div>

          <div class="form-block" data-section="instrument">
            <h2>Instrument</h2>
            <label class="field">
              <span class="label">Symbol</span>
              <input type="text" name="instrument_symbol" />
            </label>
            <div class="field field-inline">
              <label class="field" data-field="contractMultiplier">
                <span class="label">Contract multiplier</span>
                <input type="number" name="instrument_contractMultiplier" step="0.01" min="0" />
              </label>
              <label class="field" data-field="lotStep">
                <span class="label">Lot step</span>
                <input type="number" name="instrument_lotStep" step="0.01" min="0" />
              </label>
            </div>
            <div class="field field-inline">
              <label class="field" data-field="minLot">
                <span class="label">Min lot</span>
                <input type="number" name="instrument_minLot" step="0.01" min="0" />
              </label>
              <label class="field" data-field="feePerUnit">
                <span class="label">Fee per unit</span>
                <input type="number" name="instrument_feePerUnit" step="0.01" min="0" />
              </label>
            </div>
            <div class="field-error" data-error-for="contractMultiplier"></div>
            <div class="field-error" data-error-for="lotStep"></div>
            <div class="field-error" data-error-for="minLot"></div>
            <div class="field-error" data-error-for="feePerUnit"></div>
          </div>

          <div class="actions-row">
            <button type="button" id="savePresetBtn">Save preset</button>
          </div>
        </form>
      </section>

      <section class="panel results-panel">
        <div class="actions-row">
          <button type="button" class="secondary" id="recalcBtn">Recalc</button>
          <button type="button" class="secondary" id="copyBtn">Copy</button>
          <button type="button" class="secondary" id="exportCsvBtn">Export CSV</button>
          <button type="button" class="secondary" id="exportJsonBtn">Export JSON</button>
        </div>
        <div class="table-wrapper" id="resultsContainer"></div>
        <div class="warnings-panel" id="warningsContainer"></div>
        <div class="summary-panel" id="summaryContainer"></div>
      </section>
    </div>
  `;

  formElement = root.querySelector<HTMLFormElement>('#tradeForm');
  resultsContainer = root.querySelector<HTMLElement>('#resultsContainer');
  warningsContainer = root.querySelector<HTMLElement>('#warningsContainer');
  summaryContainer = root.querySelector<HTMLElement>('#summaryContainer');
  presetSelect = root.querySelector<HTMLSelectElement>('#presetSelect');

  if (formElement) {
    formElement.addEventListener('input', handleFormInput);
    formElement.addEventListener('change', handleFormChange);
  }

  root
    .querySelector<HTMLButtonElement>('#recalcBtn')
    ?.addEventListener('click', () => {
      recompute();
    });

  root
    .querySelector<HTMLButtonElement>('#copyBtn')
    ?.addEventListener('click', () => {
      handleCopy();
    });

  root
    .querySelector<HTMLButtonElement>('#exportCsvBtn')
    ?.addEventListener('click', () => {
      handleExport('csv');
    });

  root
    .querySelector<HTMLButtonElement>('#exportJsonBtn')
    ?.addEventListener('click', () => {
      handleExport('json');
    });

  root
    .querySelector<HTMLButtonElement>('#savePresetBtn')
    ?.addEventListener('click', () => {
      handleSavePreset();
    });

  presetSelect?.addEventListener('change', () => {
    const value = presetSelect?.value ?? '';
    selectedPresetId = value || null;
    if (selectedPresetId) {
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (preset) {
        applyPreset(preset);
      }
    }
  });
};

const handleFormInput = (event: Event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const { name } = target;
  if (!name) return;

  switch (name) {
    case 'direction':
      formState.direction = target.value as TradeDirection;
      break;
    case `setup_${SetupType.Breakout}`:
      formState.setups[SetupType.Breakout] = (
        target as HTMLInputElement
      ).checked;
      break;
    case `setup_${SetupType.FalseBreakout}`:
      formState.setups[SetupType.FalseBreakout] = (
        target as HTMLInputElement
      ).checked;
      break;
    case 'level':
      formState.level = parseNullableNumber(target.value);
      break;
    case 'atr':
      formState.atr = parseNullableNumber(target.value);
      break;
    case 'rrMultiple':
      formState.rrMultiple = parseNullableNumber(target.value);
      break;
    case 'bufferRatio':
      formState.bufferRatio = parseNullableNumber(target.value);
      break;
    case 'rangePassed':
      formState.rangePassed = parseNullableNumber(target.value);
      break;
    case 'currentPrice':
      formState.currentPrice = parseNullableNumber(target.value);
      break;
    case 'stop_percent':
      formState.stopSettings.percent = parseNullableNumber(target.value);
      break;
    case 'stop_atrMultiple':
      formState.stopSettings.atrMultiple = parseNullableNumber(target.value);
      break;
    case 'stop_points':
      formState.stopSettings.points = parseNullableNumber(target.value);
      break;
    case 'enableAtrFilter':
      formState.enableAtrFilter = (target as HTMLInputElement).checked;
      break;
    case 'risk_mode':
      formState.risk.mode = target.value as RiskMode;
      updateRiskVisibility();
      break;
    case 'risk_cash':
      formState.risk.riskCash = parseNullableNumber(target.value);
      break;
    case 'risk_percent':
      formState.risk.riskPercent = parseNullableNumber(target.value);
      break;
    case 'risk_accountSize':
      formState.risk.accountSize = parseNullableNumber(target.value);
      break;
    case 'risk_notional':
      formState.risk.notional = parseNullableNumber(target.value);
      break;
    case 'instrument_symbol':
      formState.instrument.symbol = target.value.toUpperCase();
      target.value = formState.instrument.symbol;
      break;
    case 'instrument_contractMultiplier':
      formState.instrument.contractMultiplier = parseNullableNumber(
        target.value
      );
      break;
    case 'instrument_lotStep':
      formState.instrument.lotStep = parseNullableNumber(target.value);
      break;
    case 'instrument_minLot':
      formState.instrument.minLot = parseNullableNumber(target.value);
      break;
    case 'instrument_feePerUnit':
      formState.instrument.feePerUnit = parseNullableNumber(target.value);
      break;
    default:
      break;
  }

  saveStateDebounced();
  recompute();
};

const handleFormChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === 'risk_mode') {
    formState.risk.mode = target.value as RiskMode;
    updateRiskVisibility();
    saveStateDebounced();
    recompute();
  }
};

const updateRiskVisibility = () => {
  const groups =
    formElement?.querySelectorAll<HTMLElement>('.risk-group') ?? [];
  groups.forEach((group) => {
    const mode = group.dataset.risk as RiskMode | undefined;
    group.classList.toggle('active', mode === formState.risk.mode);
  });
};

const updatePresetSelect = () => {
  if (!presetSelect) return;
  const currentValue = presetSelect.value;
  presetSelect.innerHTML = '<option value="">— Select preset —</option>';
  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect?.append(option);
  });
  const nextValue = selectedPresetId ?? currentValue;
  if (nextValue) {
    presetSelect.value = nextValue;
  }
};

const validateState = (state: FormState): FormErrors => {
  const errors: FormErrors = {};
  if (
    !state.setups[SetupType.Breakout] &&
    !state.setups[SetupType.FalseBreakout]
  ) {
    errors.setups = 'Select at least one setup';
  }
  if (!isPositive(state.level)) {
    errors.level = 'Level must be greater than zero';
  }
  if (!isPositive(state.atr)) {
    errors.atr = 'ATR must be greater than zero';
  }
  if (!isPositive(state.rrMultiple)) {
    errors.rrMultiple = 'RR must be greater than zero';
  }
  if (!isNonNegative(state.bufferRatio)) {
    errors.bufferRatio = 'Buffer ratio must be >= 0';
  }
  if (!isPositive(state.stopSettings.percent)) {
    errors.stopPercent = 'Provide stop % value';
  }
  if (!isPositive(state.stopSettings.atrMultiple)) {
    errors.stopAtrMultiple = 'Provide ATR multiple';
  }
  if (!isPositive(state.stopSettings.points)) {
    errors.stopPoints = 'Provide stop points';
  }
  if (!isPositive(state.instrument.contractMultiplier)) {
    errors.contractMultiplier = 'Contract multiplier must be > 0';
  }
  if (!isPositive(state.instrument.lotStep)) {
    errors.lotStep = 'Lot step must be > 0';
  }
  if (!isNonNegative(state.instrument.minLot)) {
    errors.minLot = 'Min lot must be >= 0';
  }
  if (!isNonNegative(state.instrument.feePerUnit)) {
    errors.feePerUnit = 'Fee must be >= 0';
  }

  if (state.risk.mode === 'risk_cash' && !isPositive(state.risk.riskCash)) {
    errors.riskCash = 'Risk per trade required';
  }
  if (state.risk.mode === 'risk_percent') {
    if (!isPositive(state.risk.riskPercent)) {
      errors.riskPercent = 'Risk % required';
    }
    if (!isPositive(state.risk.accountSize)) {
      errors.accountSize = 'Account size required';
    }
  }
  if (state.risk.mode === 'notional' && !isPositive(state.risk.notional)) {
    errors.notional = 'Notional required';
  }
  return errors;
};

const isPositive = (value: number | null | undefined): boolean =>
  value !== null && value !== undefined && value > 0;

const isNonNegative = (value: number | null | undefined): boolean =>
  value !== null && value !== undefined && value >= 0;

const updateFormErrors = (errors: FormErrors) => {
  if (!formElement) return;
  const fieldNames: Array<keyof FormErrors> = [
    'setups',
    'level',
    'atr',
    'rrMultiple',
    'bufferRatio',
    'stopPercent',
    'stopAtrMultiple',
    'stopPoints',
    'riskCash',
    'riskPercent',
    'accountSize',
    'notional',
    'contractMultiplier',
    'lotStep',
    'minLot',
    'feePerUnit',
  ];

  fieldNames.forEach((field) => {
    const errorText = errors[field] ?? '';
    formElement
      ?.querySelectorAll<HTMLElement>(`.field-error[data-error-for="${field}"]`)
      .forEach((el) => {
        el.textContent = errorText;
      });
  });

  formElement?.querySelectorAll<HTMLElement>('.field').forEach((field) => {
    const name = field.dataset.field as keyof FormErrors | undefined;
    if (!name) return;
    field.classList.toggle('has-error', Boolean(errors[name]));
  });
};

const syncFormInputs = () => {
  if (!formElement) return;
  const setters: Array<[string, string | number | null | boolean]> = [
    ['direction', formState.direction],
    [`setup_${SetupType.Breakout}`, formState.setups[SetupType.Breakout]],
    [
      `setup_${SetupType.FalseBreakout}`,
      formState.setups[SetupType.FalseBreakout],
    ],
    ['level', formState.level],
    ['atr', formState.atr],
    ['rrMultiple', formState.rrMultiple],
    ['bufferRatio', formState.bufferRatio],
    ['rangePassed', formState.rangePassed],
    ['currentPrice', formState.currentPrice],
    ['stop_percent', formState.stopSettings.percent],
    ['stop_atrMultiple', formState.stopSettings.atrMultiple],
    ['stop_points', formState.stopSettings.points],
    ['enableAtrFilter', formState.enableAtrFilter],
    ['risk_cash', formState.risk.riskCash],
    ['risk_percent', formState.risk.riskPercent],
    ['risk_accountSize', formState.risk.accountSize],
    ['risk_notional', formState.risk.notional],
    ['instrument_symbol', formState.instrument.symbol],
    ['instrument_contractMultiplier', formState.instrument.contractMultiplier],
    ['instrument_lotStep', formState.instrument.lotStep],
    ['instrument_minLot', formState.instrument.minLot],
    ['instrument_feePerUnit', formState.instrument.feePerUnit],
  ];

  setters.forEach(([name, value]) => {
    const input = formElement?.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!input) return;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (value === null || value === undefined) {
      input.value = '';
    } else {
      input.value = String(value);
    }
  });

  const riskRadio = formElement.elements.namedItem('risk_mode');
  const radios = formElement.querySelectorAll<HTMLInputElement>(
    'input[name="risk_mode"]'
  );
  radios.forEach((radio) => {
    radio.checked = radio.value === formState.risk.mode;
  });

  updateRiskVisibility();
};

const recompute = () => {
  formErrors = validateState(formState);
  updateFormErrors(formErrors);

  const rows = buildResultRows(formState);
  renderResults(rows);
  renderWarnings(rows);
  renderSummary(rows);
};

const buildResultRows = (state: FormState): ResultRow[] => {
  const activeSetups = setupOrder.filter((setup) => state.setups[setup]);
  if (activeSetups.length === 0) return [];

  const rows: ResultRow[] = [];

  for (const setup of activeSetups) {
    for (const stopType of stopTypes) {
      rows.push(computeRow(state, setup, stopType));
    }
  }

  return rows;
};

const computeRow = (
  state: FormState,
  setup: SetupType,
  stopType: StopType
): ResultRow => {
  const baseError = firstFatalError(formErrors);
  if (baseError) {
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: baseError,
    };
  }

  const level = state.level;
  const atr = state.atr;
  const rrMultiple = state.rrMultiple;
  const bufferRatio = state.bufferRatio ?? 0;

  if (!isPositive(level) || !isPositive(atr) || !isPositive(rrMultiple)) {
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: 'Provide base trade inputs',
    };
  }

  const stopValue = getStopValue(state, stopType);
  if (!isPositive(stopValue)) {
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: 'Stop parameters missing',
    };
  }

  const instrument = state.instrument;
  const risk = state.risk;

  if (
    !isPositive(instrument.contractMultiplier) ||
    !isPositive(instrument.lotStep)
  ) {
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: 'Instrument configuration incomplete',
    };
  }

  const riskCheck = validateRiskForMode(risk);
  if (riskCheck) {
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: riskCheck,
    };
  }

  const input: TradeInput = {
    direction: state.direction,
    setup,
    level,
    atr,
    rrMultiple,
    stop: buildStopConfig(stopType, state.stopSettings),
    bufferRatio,
    rangePassed: state.rangePassed ?? undefined,
    currentPrice: state.currentPrice ?? undefined,
    enableAtrFilter: state.enableAtrFilter,
    instrument: {
      symbol: instrument.symbol,
      contractMultiplier: instrument.contractMultiplier ?? 1,
      lotStep: instrument.lotStep ?? 1,
      minLot: instrument.minLot ?? 0,
      feePerUnit: instrument.feePerUnit ?? 0,
      priceTick: instrument.priceTick ?? undefined,
    },
    riskProfile: {
      mode: risk.mode,
      riskCash: risk.riskCash ?? undefined,
      riskPercent: risk.riskPercent ?? undefined,
      accountSize: risk.accountSize ?? undefined,
      notional: risk.notional ?? undefined,
    },
  };

  try {
    const response = calculateTrade(input);
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      response,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Calculation failed';
    return {
      id: `${setup}_${stopType}`,
      setup,
      stopType,
      error: message,
    };
  }
};

const firstFatalError = (errors: FormErrors): string | undefined => {
  const order: Array<keyof FormErrors> = [
    'setups',
    'level',
    'atr',
    'rrMultiple',
    'bufferRatio',
    'contractMultiplier',
    'lotStep',
    'riskCash',
    'riskPercent',
    'accountSize',
    'notional',
  ];
  for (const key of order) {
    const error = errors[key];
    if (error) return error;
  }
  return undefined;
};

const getStopValue = (state: FormState, stopType: StopType): number | null => {
  switch (stopType) {
    case StopType.FixedPercent:
      return state.stopSettings.percent;
    case StopType.AtrMultiple:
      return state.stopSettings.atrMultiple;
    case StopType.FixedPoints:
      return state.stopSettings.points;
    default:
      return null;
  }
};

const buildStopConfig = (
  stopType: StopType,
  stopSettings: StopSettings
): TradeInput['stop'] => {
  if (stopType === StopType.FixedPercent) {
    return { type: StopType.FixedPercent, percent: stopSettings.percent ?? 0 };
  }
  if (stopType === StopType.AtrMultiple) {
    return {
      type: StopType.AtrMultiple,
      atrMultiple: stopSettings.atrMultiple ?? 0,
    };
  }
  return { type: StopType.FixedPoints, points: stopSettings.points ?? 0 };
};

const validateRiskForMode = (risk: RiskState): string | null => {
  if (risk.mode === 'risk_cash' && !isPositive(risk.riskCash)) {
    return 'Risk per trade required';
  }
  if (risk.mode === 'risk_percent') {
    if (!isPositive(risk.riskPercent)) return 'Risk % required';
    if (!isPositive(risk.accountSize)) return 'Account size required';
  }
  if (risk.mode === 'notional' && !isPositive(risk.notional)) {
    return 'Notional required';
  }
  return null;
};

const renderResults = (rows: ResultRow[]) => {
  if (!resultsContainer) return;
  if (rows.length === 0) {
    resultsContainer.innerHTML =
      '<div class="empty-state">Configure the form to see results.</div>';
    return;
  }

  type MetricDefinition = {
    label: string;
    getValue: (row: ResultRow) => string;
  };

  const metrics: MetricDefinition[] = [
    {
      label: 'Direction',
      getValue: (row) =>
        row.response
          ? capitalize(row.response.result.direction)
          : capitalize(formState.direction),
    },
    {
      label: 'Setup',
      getValue: (row) => SETUP_LABELS[row.setup],
    },
    {
      label: 'Stop type',
      getValue: (row) => STOP_LABELS[row.stopType],
    },
    {
      label: 'Level',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.level, 2) : '—',
    },
    {
      label: 'Stop (pts)',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.stop, 4) : '—',
    },
    {
      label: 'Buffer',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.buffer, 4) : '—',
    },
    {
      label: 'TVX',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.tvx, 4) : '—',
    },
    {
      label: 'SL',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.slPrice, 4) : '—',
    },
    {
      label: 'TP',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.tpPrice, 4) : '—',
    },
    {
      label: 'RR',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.rrMultiple, 2) : '—',
    },
    {
      label: 'ATR/Stop',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.atrOverStop, 2) : '—',
    },
    {
      label: 'Range/Stop',
      getValue: (row) => {
        if (!row.response) return '—';
        const ratio = row.response.result.rangeOverStop;
        return ratio === RANGE_UNKNOWN ? RANGE_UNKNOWN : formatNumber(ratio, 2);
      },
    },
    {
      label: '>=4 stops?',
      getValue: (row) =>
        row.response ? toBadge(row.response.result.hasFourStops) : '—',
    },
    {
      label: 'Stop <= 0.2*ATR?',
      getValue: (row) =>
        row.response ? toBadge(row.response.result.stopWithinAtrFilter) : '—',
    },
    {
      label: 'Qty',
      getValue: (row) =>
        row.response ? formatInteger(row.response.result.quantity) : '—',
    },
    {
      label: 'Notional',
      getValue: (row) =>
        row.response ? formatNumber(row.response.result.notional, 2) : '—',
    },
    {
      label: 'Status',
      getValue: (row) =>
        row.response
          ? '<span class="badge yes">OK</span>'
          : `<span class="muted">${row.error ?? 'No result'}</span>`,
    },
  ];

  const cards = rows
    .map((row) => {
      const directionLabel = row.response
        ? capitalize(row.response.result.direction)
        : capitalize(formState.direction);
      const headerLabel = `${SETUP_LABELS[row.setup]} · ${STOP_LABELS[row.stopType]}`;
      const metricRows = metrics
        .map(
          (metric) => `
            <tr>
              <th scope="row">${metric.label}</th>
              <td>${metric.getValue(row)}</td>
            </tr>
          `.trim()
        )
        .join('');

      return `
        <article class="result-card">
          <header class="result-card__header">
            <span class="result-card__title">${directionLabel}</span>
            <span class="result-card__subtitle">${headerLabel}</span>
          </header>
          <table class="result-card__table">
            <tbody>
              ${metricRows}
            </tbody>
          </table>
        </article>
      `.trim();
    })
    .join('');

  resultsContainer.innerHTML = `<div class="results-grid">${cards}</div>`;
};

const renderWarnings = (rows: ResultRow[]) => {
  if (!warningsContainer) return;
  const warnings = new Set<string>();
  rows.forEach((row) => {
    if (row.error) {
      warnings.add(
        `${SETUP_LABELS[row.setup]} / ${STOP_LABELS[row.stopType]}: ${row.error}`
      );
    }
    row.response?.result.warnings.forEach((warning) => {
      warnings.add(
        `${SETUP_LABELS[row.setup]} / ${STOP_LABELS[row.stopType]}: ${warning}`
      );
    });
    if (row.response?.result.belowMinLot) {
      warnings.add('Quantity adjusted to match minimum lot constraints');
    }
  });

  if (warnings.size === 0) {
    warningsContainer.innerHTML = `
      <h3>Warnings</h3>
      <p class="muted">No warnings.</p>
    `;
    return;
  }

  const items = Array.from(warnings)
    .map((warning) => `<li>${warning}</li>`)
    .join('');

  warningsContainer.innerHTML = `
    <h3>Warnings</h3>
    <ul>${items}</ul>
  `;
};

const renderSummary = (rows: ResultRow[]) => {
  if (!summaryContainer) return;
  const row =
    rows.find(
      (item) =>
        item.response &&
        item.setup === SetupType.Breakout &&
        item.stopType === StopType.FixedPercent
    ) || rows.find((item) => item.response);

  if (!row || !row.response) {
    summaryContainer.innerHTML = `
      <h3>Position summary</h3>
      <p class="muted">Enter trade data to review the position.</p>
    `;
    return;
  }

  const { result } = row.response;
  const riskCash = result.positionSummary.riskCash;
  const estFees = result.positionSummary.estFees;
  const pnlTp = result.positionSummary.pnlAtTp;
  const pnlSl = result.positionSummary.pnlAtSl;
  const cpToTvx = result.currentPriceToTvx;
  const stopAtrPercent = result.stopAtrPercent;

  summaryContainer.innerHTML = `
    <h3>Position summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="label">Risk / trade</span>
        <span class="value">${formatNumber(riskCash, 2)}</span>
      </div>
      <div class="summary-item">
        <span class="label">Quantity</span>
        <span class="value">${formatInteger(result.quantity)}</span>
      </div>
      <div class="summary-item">
        <span class="label">Notional</span>
        <span class="value">${formatNumber(result.notional, 2)}</span>
      </div>
      <div class="summary-item">
        <span class="label">Estimated fees</span>
        <span class="value">${formatNumber(estFees, 2)}</span>
      </div>
      <div class="summary-item">
        <span class="label">P&L at TP</span>
        <span class="value text-success">${formatNumber(pnlTp, 2)}</span>
      </div>
      <div class="summary-item">
        <span class="label">P&L at SL</span>
        <span class="value text-danger">${formatNumber(pnlSl, 2)}</span>
      </div>
      <div class="summary-item">
        <span class="label">Current → TVX</span>
        <span class="value">${
          cpToTvx === undefined ? '—' : formatNumber(cpToTvx, 4)
        }</span>
      </div>
      <div class="summary-item">
        <span class="label">Stop / ATR %</span>
        <span class="value">${formatNumber(stopAtrPercent, 2)}%</span>
      </div>
    </div>
  `;
};

const handleCopy = () => {
  if (!navigator.clipboard) return;
  const rows = buildResultRows(formState);
  if (rows.length === 0) return;
  const headers = [
    'Direction',
    'Setup',
    'Stop type',
    'Level',
    'Stop',
    'Buffer',
    'TVX',
    'SL',
    'TP',
    'RR',
    'ATR/Stop',
    'Range/Stop',
    'FourStops',
    'StopFilter',
    'Qty',
    'Notional',
  ];
  const lines = [headers.join('\t')];
  rows.forEach((row) => {
    if (!row.response) {
      lines.push(
        [
          capitalize(formState.direction),
          SETUP_LABELS[row.setup],
          STOP_LABELS[row.stopType],
          row.error ?? 'Error',
        ].join('\t')
      );
      return;
    }
    const r = row.response.result;
    lines.push(
      [
        capitalize(r.direction),
        SETUP_LABELS[row.setup],
        STOP_LABELS[row.stopType],
        r.level,
        r.stop,
        r.buffer,
        r.tvx,
        r.slPrice,
        r.tpPrice,
        r.rrMultiple,
        r.atrOverStop,
        r.rangeOverStop === RANGE_UNKNOWN ? RANGE_UNKNOWN : r.rangeOverStop,
        r.hasFourStops ? 'Yes' : 'No',
        r.stopWithinAtrFilter ? 'Yes' : 'No',
        r.quantity,
        r.notional,
      ]
        .map(String)
        .join('\t')
    );
  });
  void navigator.clipboard.writeText(lines.join('\n'));
};

const handleExport = (format: 'csv' | 'json') => {
  const rows = buildResultRows(formState).filter((row) => row.response);
  if (rows.length === 0) return;

  if (format === 'json') {
    const payload = rows.map((row) => ({
      direction: row.response!.result.direction,
      setup: row.setup,
      stopType: row.stopType,
      result: row.response!.result,
    }));
    downloadFile(
      'trade-scope-results.json',
      JSON.stringify(payload, null, 2),
      'application/json'
    );
    return;
  }

  const csvRows = rows.map((row) => {
    const r = row.response!.result;
    const rangeValue =
      r.rangeOverStop === RANGE_UNKNOWN ? '' : formatNumber(r.rangeOverStop, 4);
    return [
      capitalize(r.direction),
      SETUP_LABELS[row.setup],
      STOP_LABELS[row.stopType],
      formatNumber(r.level, 4),
      formatNumber(r.stop, 6),
      formatNumber(r.buffer, 6),
      formatNumber(r.tvx, 4),
      formatNumber(r.slPrice, 4),
      formatNumber(r.tpPrice, 4),
      formatNumber(r.rrMultiple, 2),
      formatNumber(r.atrOverStop, 4),
      rangeValue,
      r.hasFourStops ? 'Yes' : 'No',
      r.stopWithinAtrFilter ? 'Yes' : 'No',
      formatInteger(r.quantity),
      formatNumber(r.notional, 2),
    ];
  });
  const csvContent = [
    [
      'Direction',
      'Setup',
      'Stop type',
      'Level',
      'Stop',
      'Buffer',
      'TVX',
      'SL',
      'TP',
      'RR',
      'ATR/Stop',
      'Range/Stop',
      'FourStops',
      'StopFilter',
      'Qty',
      'Notional',
    ],
    ...csvRows,
  ]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  downloadFile('trade-scope-results.csv', csvContent, 'text/csv');
};

const csvEscape = (value: string): string => {
  if (value.includes(',') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const downloadFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const handleSavePreset = () => {
  const name = window.prompt('Preset name');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const preset: Preset = {
    id: `${Date.now()}`,
    name: trimmed,
    risk: cloneState(formState.risk),
    instrument: cloneState(formState.instrument),
  };

  presets = presets.filter((item) => item.name !== trimmed);
  presets.push(preset);
  selectedPresetId = preset.id;
  updatePresetSelect();
  saveStateDebounced();
};

const applyPreset = (preset: Preset) => {
  formState.risk = cloneState(preset.risk);
  formState.instrument = cloneState(preset.instrument);
  syncFormInputs();
  recompute();
  saveStateDebounced();
};

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

const init = async () => {
  await loadInitialState();
  renderLayout();
  syncFormInputs();
  updatePresetSelect();
  recompute();
};

void init();
