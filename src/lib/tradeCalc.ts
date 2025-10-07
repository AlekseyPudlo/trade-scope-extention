export enum TradeDirection {
  Long = 'long',
  Short = 'short',
}

export enum StopType {
  FixedPercent = 'fixed_percent',
  AtrMultiple = 'atr_multiple',
  FixedPoints = 'fixed_points',
}

export enum SetupType {
  Breakout = 'breakout',
  FalseBreakout = 'false_breakout',
}

export const RANGE_UNKNOWN = 'UNKNOWN' as const;
type RangeUnknown = typeof RANGE_UNKNOWN;

export interface InstrumentProfile {
  symbol: string;
  contractMultiplier: number; // e.g. 1 for equities, 100 for futures
  lotStep: number; // minimum increment for quantity
  minLot: number; // absolute minimum quantity
  feePerUnit?: number; // optional commission/slippage per unit
  priceTick?: number; // optional price increment hint
}

export interface RiskProfile {
  mode: 'risk_cash' | 'risk_percent' | 'notional';
  accountSize?: number;
  riskCash?: number;
  riskPercent?: number; // interpreted vs accountSize
  notional?: number;
}

export interface TradeInput {
  direction: TradeDirection;
  setup: SetupType;
  level: number;
  atr: number;
  rrMultiple: number;
  stop: {
    type: StopType;
    percent?: number; // for FixedPercent
    atrMultiple?: number; // for AtrMultiple
    points?: number; // for FixedPoints
  };
  bufferRatio: number; // e.g. 0.2
  rangePassed?: number;
  currentPrice?: number;
  enableAtrFilter?: boolean; // default true
  instrument: InstrumentProfile;
  riskProfile: RiskProfile;
}

export interface TradeResult {
  direction: TradeDirection;
  setup: SetupType;
  level: number;
  stop: number;
  buffer: number;
  tvx: number;
  slPrice: number;
  tpPrice: number;
  rrMultiple: number;
  atrOverStop: number;
  rangeOverStop: number | RangeUnknown;
  hasFourStops: boolean;
  stopWithinAtrFilter: boolean;
  warnings: string[];
  quantity: number;
  notional: number;
  belowMinLot: boolean;
  positionSummary: {
    riskCash: number;
    estFees: number;
    pnlAtTp: number;
    pnlAtSl: number;
  };
  currentPriceToTvx?: number;
  stopAtrPercent: number;
}

export interface TradeCalcResponse {
  result: TradeResult;
  meta: {
    usedRiskCash: number;
    usedNotional?: number;
  };
}

// helpers for each formula
const roundDownToStep = (qty: number, step: number): number => {
  if (step <= 0) {
    return Math.max(qty, 0);
  }
  const scaled = qty / step;
  const floored = Math.floor(scaled + 1e-9);
  const rounded = floored * step;
  const normalized = Number.isFinite(rounded)
    ? Number(rounded.toFixed(8))
    : 0;
  return normalized < 0 ? 0 : normalized;
};

const roundUpToStep = (qty: number, step: number): number => {
  if (step <= 0) {
    return Math.max(qty, 0);
  }
  const scaled = qty / step;
  const ceiled = Math.ceil(scaled - 1e-9);
  const rounded = ceiled * step;
  const normalized = Number.isFinite(rounded)
    ? Number(rounded.toFixed(8))
    : 0;
  return normalized < 0 ? 0 : normalized;
};

const computeStop = (input: TradeInput): number => {
  const { stop, level, atr } = input;
  switch (stop.type) {
    case StopType.FixedPercent:
      return ((stop.percent ?? 0.3) / 100) * level;
    case StopType.AtrMultiple:
      return (stop.atrMultiple ?? 0.5) * atr;
    case StopType.FixedPoints:
      return stop.points ?? 0;
    default:
      throw new Error('Unsupported stop type');
  }
};

const computeBuffer = (stop: number, bufferRatio: number): number =>
  stop * bufferRatio;

const computeTvx = (input: TradeInput, buffer: number): number => {
  const { direction, level } = input;
  if (direction === TradeDirection.Long) {
    return level + buffer;
  }
  return level - buffer;
};

const computeSlPrice = (input: TradeInput, stop: number): number => {
  const { direction, level } = input;
  return direction === TradeDirection.Long ? level - stop : level + stop;
};

const computeTpPrice = (
  input: TradeInput,
  tvx: number,
  stop: number
): number => {
  const { direction, rrMultiple } = input;
  return direction === TradeDirection.Long
    ? tvx + rrMultiple * stop
    : tvx - rrMultiple * stop;
};

// risk sizing + warnings
const costPerUnit = (
  stopValuePerUnit: number,
  feePerUnit: number
): number => stopValuePerUnit + feePerUnit;

const calcQuantity = (
  input: TradeInput,
  stop: number
): {
  quantity: number;
  usedRiskCash: number;
  notional: number;
  estFees: number;
  belowMinLot: boolean;
} => {
  const { instrument, riskProfile, level } = input;
  const feePerUnit = instrument.feePerUnit ?? 0;
  const contractMultiplier = instrument.contractMultiplier;

  const stopValuePerUnit = stop * contractMultiplier;
  const unitCost = costPerUnit(stopValuePerUnit, feePerUnit);
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    throw new Error('Calculated unit cost must be positive and finite');
  }

  let qtyRaw = 0;

  if (riskProfile.mode === 'risk_cash') {
    const riskCash = riskProfile.riskCash ?? 0;
    qtyRaw = Math.max(Math.floor(riskCash / unitCost), 0);
  } else if (riskProfile.mode === 'risk_percent') {
    const accountSize = riskProfile.accountSize ?? 0;
    const riskCash = (accountSize * (riskProfile.riskPercent ?? 0)) / 100;
    qtyRaw = Math.max(Math.floor(riskCash / unitCost), 0);
  } else if (riskProfile.mode === 'notional') {
    const notional = riskProfile.notional ?? 0;
    const denom = level * contractMultiplier;
    qtyRaw = denom > 0 ? Math.max(Math.floor(notional / denom), 0) : 0;
  }

  const step = instrument.lotStep > 0 ? instrument.lotStep : 1;
  const roundedQty = roundDownToStep(qtyRaw, step);
  const minLot = instrument.minLot > 0 ? instrument.minLot : 0;
  const minLotAligned =
    minLot > 0 ? Math.max(roundUpToStep(minLot, step), minLot) : 0;
  let quantity =
    minLotAligned > 0 ? Math.max(roundedQty, minLotAligned) : roundedQty;
  quantity = Number.isFinite(quantity)
    ? Number(quantity.toFixed(8))
    : 0;
  const belowMinLot =
    minLotAligned > 0 && roundedQty < minLotAligned && quantity > 0;

  const estFees = quantity * feePerUnit;
  const notional = quantity * level * contractMultiplier;
  const usedRiskCash = quantity * unitCost;

  return { quantity, usedRiskCash, notional, estFees, belowMinLot };
};

const collectWarnings = (result: {
  atrCheckFailed: boolean;
  rangeCheckFailed?: boolean;
  stopFilterFailed: boolean;
  belowMinLot: boolean;
}): string[] => {
  const warnings: string[] = [];
  if (result.atrCheckFailed) warnings.push('ATR/Stop < 4');
  if (result.rangeCheckFailed) warnings.push('Range/Stop < 4');
  if (result.stopFilterFailed) warnings.push('Stop exceeds 20% ATR limit');
  if (result.belowMinLot)
    warnings.push('Qty is below minimum lot');
  return warnings;
};

// main functionality
export const calculateTrade = (input: TradeInput): TradeCalcResponse => {
  if (input.level <= 0) {
    throw new Error('Level must be greater than zero');
  }
  if (input.atr <= 0) {
    throw new Error('ATR must be greater than zero');
  }
  if (input.rrMultiple <= 0) {
    throw new Error('Risk/reward multiple must be greater than zero');
  }
  if (input.bufferRatio < 0) {
    throw new Error('Buffer ratio must be non-negative');
  }
  if (input.instrument.contractMultiplier <= 0) {
    throw new Error('Contract multiplier must be greater than zero');
  }

  const stop = computeStop(input);
  if (stop <= 0) {
    throw new Error('Computed stop must be greater than zero');
  }
  const buffer = computeBuffer(stop, input.bufferRatio);
  const tvx = computeTvx(input, buffer);
  const slPrice = computeSlPrice(input, stop);
  const tpPrice = computeTpPrice(input, tvx, stop);
  const contractMultiplier = input.instrument.contractMultiplier;

  const atrOverStop = input.atr / stop;
  const rangeOverStop =
    input.rangePassed != null ? input.rangePassed / stop : RANGE_UNKNOWN;
  const hasRange = typeof rangeOverStop === 'number';
  const atrCheckFailed = atrOverStop < 4;
  const rangeCheckFailedFlag = hasRange ? rangeOverStop < 4 : false;
  const hasFourStops = !atrCheckFailed && (!hasRange || !rangeCheckFailedFlag);
  const stopWithinFilter = !input.enableAtrFilter || stop <= 0.2 * input.atr;

  const { quantity, usedRiskCash, notional, estFees, belowMinLot } = calcQuantity(
    input,
    stop
  );

  const warningInput: Parameters<typeof collectWarnings>[0] = {
    atrCheckFailed,
    stopFilterFailed: !stopWithinFilter,
    belowMinLot,
  };

  if (hasRange) {
    warningInput.rangeCheckFailed = rangeCheckFailedFlag;
  }

  const warnings = collectWarnings(warningInput);

  const tpDistance =
    input.direction === TradeDirection.Long ? tpPrice - tvx : tvx - tpPrice;
  const slDistance =
    input.direction === TradeDirection.Long ? tvx - slPrice : slPrice - tvx;

  const pnlAtTp = tpDistance * quantity * contractMultiplier;
  const pnlAtSl = -slDistance * quantity * contractMultiplier;
  const result: TradeResult = {
    direction: input.direction,
    setup: input.setup,
    level: input.level,
    stop,
    buffer,
    tvx,
    slPrice,
    tpPrice,
    rrMultiple: input.rrMultiple,
    atrOverStop,
    rangeOverStop,
    hasFourStops,
    stopWithinAtrFilter: stopWithinFilter,
    warnings,
    quantity,
    notional,
    belowMinLot,
    positionSummary: {
      riskCash: usedRiskCash,
      estFees,
      pnlAtTp,
      pnlAtSl,
    },
    stopAtrPercent:
      input.atr > 0 ? (stop / input.atr) * 100 : Number.POSITIVE_INFINITY,
  };

  if (input.currentPrice != null) {
    result.currentPriceToTvx = input.currentPrice - tvx;
  }

  const meta: TradeCalcResponse['meta'] = {
    usedRiskCash,
  };

  if (input.riskProfile.mode === 'notional') {
    meta.usedNotional = notional;
  }

  return {
    result,
    meta,
  };
};
