/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'

import {
  RANGE_UNKNOWN,
  SetupType,
  StopType,
  TradeDirection,
  calculateTrade,
  type InstrumentProfile,
  type RiskProfile,
  type TradeInput,
} from '../src/lib/tradeCalc.js'

const baseInstrument: InstrumentProfile = {
  symbol: 'TEST',
  contractMultiplier: 1,
  lotStep: 1,
  minLot: 1,
  feePerUnit: 0.2,
}

const baseRisk: RiskProfile = {
  mode: 'risk_cash',
  riskCash: 100,
}

describe('calculateTrade', () => {
  it('computes breakout long with fixed percent stop', () => {
    const input = {
      direction: TradeDirection.Long,
      setup: SetupType.Breakout,
      level: 100,
      atr: 2,
      rrMultiple: 3,
      stop: { type: StopType.FixedPercent, percent: 0.3 },
      bufferRatio: 0.2,
      currentPrice: 99.5,
      enableAtrFilter: true,
      instrument: { ...baseInstrument },
      riskProfile: { ...baseRisk },
    } satisfies TradeInput

    const { result, meta } = calculateTrade(input)

    expect(result.stop).toBeCloseTo(0.3, 6)
    expect(result.buffer).toBeCloseTo(0.06, 6)
    expect(result.tvx).toBeCloseTo(100.06, 6)
    expect(result.slPrice).toBeCloseTo(99.7, 6)
    expect(result.tpPrice).toBeCloseTo(100.96, 6)
    expect(result.atrOverStop).toBeCloseTo(6.6666667, 6)
    expect(result.rangeOverStop).toBe(RANGE_UNKNOWN)
    expect(result.hasFourStops).toBe(true)
    expect(result.stopWithinAtrFilter).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.quantity).toBe(200)
    expect(result.belowMinLot).toBe(false)
    expect(result.notional).toBeCloseTo(20000, 6)
    expect(result.positionSummary.riskCash).toBeCloseTo(100, 6)
    expect(result.positionSummary.estFees).toBeCloseTo(40, 6)
    expect(result.positionSummary.pnlAtTp).toBeCloseTo(180, 6)
    expect(result.positionSummary.pnlAtSl).toBeCloseTo(-72, 6)
    expect(result.stopAtrPercent).toBeCloseTo(15, 6)
    expect(result.currentPriceToTvx).toBeCloseTo(-0.56, 6)
    expect(meta.usedRiskCash).toBeCloseTo(100, 6)
    expect(meta.usedNotional).toBeUndefined()
  })

  it('flags validation warnings for short false breakout with fixed points stop', () => {
    const instrument: InstrumentProfile = {
      symbol: 'FUT',
      contractMultiplier: 1,
      lotStep: 1,
      minLot: 25,
      feePerUnit: 0,
    }

    const risk: RiskProfile = {
      mode: 'risk_cash',
      riskCash: 10,
    }

    const input = {
      direction: TradeDirection.Short,
      setup: SetupType.FalseBreakout,
      level: 50,
      atr: 1,
      rrMultiple: 2,
      stop: { type: StopType.FixedPoints, points: 0.5 },
      bufferRatio: 0.2,
      rangePassed: 1,
      currentPrice: 50.3,
      enableAtrFilter: true,
      instrument,
      riskProfile: risk,
    } satisfies TradeInput

    const { result, meta } = calculateTrade(input)

    expect(result.stop).toBeCloseTo(0.5, 6)
    expect(result.buffer).toBeCloseTo(0.1, 6)
    expect(result.tvx).toBeCloseTo(49.9, 6)
    expect(result.slPrice).toBeCloseTo(50.5, 6)
    expect(result.tpPrice).toBeCloseTo(48.9, 6)
    expect(result.atrOverStop).toBeCloseTo(2, 6)
    expect(result.rangeOverStop).toBeCloseTo(2, 6)
    expect(result.hasFourStops).toBe(false)
    expect(result.stopWithinAtrFilter).toBe(false)
    expect(result.warnings).toEqual([
      'ATR/Stop < 4',
      'Range/Stop < 4',
      'Stop exceeds 20% ATR limit',
      'Qty is below minimum lot',
    ])
    expect(result.quantity).toBe(25)
    expect(result.belowMinLot).toBe(true)
    expect(result.positionSummary.riskCash).toBeCloseTo(12.5, 6)
    expect(result.positionSummary.pnlAtTp).toBeCloseTo(25, 6)
    expect(result.positionSummary.pnlAtSl).toBeCloseTo(-15, 6)
    expect(result.stopAtrPercent).toBeCloseTo(50, 6)
    expect(result.currentPriceToTvx).toBeCloseTo(0.4, 6)
    expect(meta.usedRiskCash).toBeCloseTo(12.5, 6)
    expect(meta.usedNotional).toBeUndefined()
  })

  it('supports notional risk mode and disabled ATR filter', () => {
    const instrument: InstrumentProfile = {
      symbol: 'FUT',
      contractMultiplier: 100,
      lotStep: 1,
      minLot: 1,
      feePerUnit: 5,
    }

    const risk: RiskProfile = {
      mode: 'notional',
      notional: 500_000,
    }

    const input = {
      direction: TradeDirection.Long,
      setup: SetupType.Breakout,
      level: 2500,
      atr: 80,
      rrMultiple: 2,
      stop: { type: StopType.AtrMultiple, atrMultiple: 0.5 },
      bufferRatio: 0.2,
      rangePassed: 220,
      enableAtrFilter: false,
      instrument,
      riskProfile: risk,
    } satisfies TradeInput

    const { result, meta } = calculateTrade(input)

    expect(result.stop).toBeCloseTo(40, 6)
    expect(result.buffer).toBeCloseTo(8, 6)
    expect(result.tvx).toBeCloseTo(2508, 6)
    expect(result.slPrice).toBeCloseTo(2460, 6)
    expect(result.tpPrice).toBeCloseTo(2588, 6)
    expect(result.atrOverStop).toBeCloseTo(2, 6)
    expect(result.rangeOverStop).toBeCloseTo(5.5, 6)
    expect(result.hasFourStops).toBe(false)
    expect(result.stopWithinAtrFilter).toBe(true)
    expect(result.warnings).toEqual(['ATR/Stop < 4'])
    expect(result.quantity).toBe(2)
    expect(result.belowMinLot).toBe(false)
    expect(result.notional).toBeCloseTo(500_000, 6)
    expect(result.positionSummary.riskCash).toBeCloseTo(8_010, 6)
    expect(result.positionSummary.estFees).toBeCloseTo(10, 6)
    expect(result.positionSummary.pnlAtTp).toBeCloseTo(16_000, 6)
    expect(result.positionSummary.pnlAtSl).toBeCloseTo(-9_600, 6)
    expect(result.currentPriceToTvx).toBeUndefined()
    expect(meta.usedRiskCash).toBeCloseTo(8_010, 6)
    expect(meta.usedNotional).toBeCloseTo(500_000, 6)
  })

  it('throws for invalid level input', () => {
    const invalidInput = {
      direction: TradeDirection.Long,
      setup: SetupType.Breakout,
      level: 0,
      atr: 1,
      rrMultiple: 2,
      stop: { type: StopType.FixedPoints, points: 1 },
      bufferRatio: 0.2,
      instrument: { ...baseInstrument },
      riskProfile: { ...baseRisk },
    } as unknown as TradeInput

    expect(() => calculateTrade(invalidInput)).toThrow(
      'Level must be greater than zero'
    )
  })
})
