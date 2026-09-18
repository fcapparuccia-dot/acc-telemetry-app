'use client';

import React, { useState, ChangeEvent } from 'react';

// --- TIPI E INTERFACCE ---
export interface CornerData {
  pressure: number; // psi
  temp: number;     // °C
  brakeTemp: number;// °C
}

export interface LapTelemetry {
  lapNumber: number;
  durationSec: number;
  lapTimeFormatted: string;
  isBestLap?: boolean;
  topSpeed: number;
  corners: {
    lf: CornerData;
    rf: CornerData;
    lr: CornerData;
    rr: CornerData;
  };
  electronics: {
    tcUsagePct: number;
    absUsagePct: number;
    currentTc: number;
    currentAbs: number;
  };
  dynamics: {
    maxSteerAngle: number;
    highSpeedUndersteer: boolean;
    lowSpeedOversteer: boolean;
    frontRideHeight: number;
    rearRideHeight: number;
  };
  mechanical: {
    camberFront: number; // Gradi sessagesimali (es. -3.5°)
    camberRear: number;  // Gradi sessagesimali (es. -2.5°)
    maxSuspTravelFront: number; // mm
    maxSuspTravelRear: number;  // mm
    bottomingOutFront: boolean;
    bottomingOutRear: boolean;
    rollFront: number;         // Gradi appoggio asse anteriore
    rollRear: number;          // Gradi appoggio asse posteriore
  };
}

export interface TelemetrySession {
  track: string;
  car: string;
  bestLapTime: string;
  bestLapNumber: number;
  laps: LapTelemetry[];
}

export interface SetupAction {
  id: string;
  category: 'Tyres' | 'Electronics' | 'Mechanical' | 'Aero';
  component: string;
  action: string;
  delta: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

const TARGET_PRESS_MIN = 26.8;
const TARGET_PRESS_MAX = 27.3;
const TARGET_PRESS_OPT = 27.05;

export default function AccSetupDashboard() {
  const [activeTab, setActiveTab] = useState<'tyres' | 'electronics' | 'dampers' | 'aero' | 'summary'>('tyres');
  const [session, setSession] = useState<TelemetrySession | null>(null);
  const [selectedLapIdx, setSelectedLapIdx] = useState<number>(0);
  const [actions, setActions] = useState<SetupAction[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  const currentLap = session?.laps[selectedLapIdx] || null;
  const dynamicRake = currentLap ? currentLap.dynamics.rearRideHeight - currentLap.dynamics.frontRideHeight : 0;

  // --- LOGICA DI DIAGNOSI SETUP & SUGGERIMENTI DINAMICI ---
  const analyzeTelemetry = (data: LapTelemetry) => {
    const generatedActions: SetupAction[] = [];

    // 1. Pressioni Pneumatici
    const corners = [
      { key: 'lf', name: 'Anteriore Sinistra (LF)', val: data.corners.lf.pressure },
      { key: 'rf', name: 'Anteriore Destra (RF)', val: data.corners.rf.pressure },
      { key: 'lr', name: 'Posteriore Sinistra (LR)', val: data.corners.lr.pressure },
      { key: 'rr', name: 'Posteriore Destra (RR)', val: data.corners.rr.pressure },
    ];

    corners.forEach((c) => {
      const diff = parseFloat((TARGET_PRESS_OPT - c.val).toFixed(2));
      if (c.val < TARGET_PRESS_MIN) {
        generatedActions.push({
          id: `press-${c.key}`,
          category: 'Tyres',
          component: `Pressione ${c.name}`,
          action: `Aumenta Pressione`,
          delta: `+${diff} psi`,
          reason: `Pressione media (${c.val.toFixed(1)} psi) inferiore al range ideale (26.8 - 27.3 psi)`,
          severity: 'high',
        });
      } else if (c.val > TARGET_PRESS_MAX) {
        generatedActions.push({
          id: `press-${c.key}`,
          category: 'Tyres',
          component: `Pressione ${c.name}`,
          action: `Riduci Pressione`,
          delta: `${diff} psi`,
          reason: `Pressione media (${c.val.toFixed(1)} psi) superiore al range ideale (26.8 - 27.3 psi)`,
          severity: 'high',
        });
      }
    });

    // 2. Elettronica
    if (data.electronics.tcUsagePct > 18) {
      generatedActions.push({
        id: 'tc-high',
        category: 'Electronics',
        component: 'Traction Control (TC1)',
        action: 'Riduci TC o Ammorbidisci Posteriore',
        delta: '-1 Click',
        reason: `L'intervento del TC è alto (${data.electronics.tcUsagePct.toFixed(1)}%). Taglia potenza in uscita.`,
        severity: 'medium',
      });
    }

    if (data.electronics.absUsagePct > 15) {
      generatedActions.push({
        id: 'abs-high',
        category: 'Electronics',
        component: 'ABS / Ripartizione Frenata',
        action: 'Sposta Ripartizione Frenata in Avanti',
        delta: '+0.8% Anteriore',
        reason: `Frequenti bloccaggi gestiti dall'ABS (${data.electronics.absUsagePct.toFixed(1)}%).`,
        severity: 'medium',
      });
    }

    // 3. Meccanica (Camber, Molle/Tamponi, ARB Ant e Post separate)
    if (data.mechanical.camberFront > -2.5) {
      generatedActions.push({
        id: 'camber-front-add',
        category: 'Mechanical',
        component: 'Campanatura Anteriore',
        action: 'Aumenta Camber Negativo',
        delta: '-0.3°',
        reason: `Camber anteriore troppo basso (${data.mechanical.camberFront}°). Riduce l'impronta a terra in curva.`,
        severity: 'medium',
      });
    } else if (data.mechanical.camberFront < -4.2) {
      generatedActions.push({
        id: 'camber-front-sub',
        category: 'Mechanical',
        component: 'Campanatura Anteriore',
        action: 'Riduci Camber Negativo',
        delta: '+0.3°',
        reason: `Camber anteriore troppo aggressivo (${data.mechanical.camberFront}°). Eccessivo carico sulla spalla interna.`,
        severity: 'high',
      });
    }

    if (data.mechanical.rollFront > 2.8) {
      generatedActions.push({
        id: 'arb-front',
        category: 'Mechanical',
        component: 'Barra Antirollio Anteriore',
        action: 'Indurisci ARB Anteriore',
        delta: '+1 Click',
        reason: `Rollio anteriore eccessivo (${data.mechanical.rollFront}°). Riduce la prontezza d'inserimento.`,
        severity: 'medium',
      });
    }

    if (data.mechanical.rollRear > 2.5) {
      generatedActions.push({
        id: 'arb-rear',
        category: 'Mechanical',
        component: 'Barra Antirollio Posteriore',
        action: 'Indurisci ARB Posteriore',
        delta: '+1 Click',
        reason: `Rollio posteriore elevato (${data.mechanical.rollRear}°). Poco supporto in uscita di curva.`,
        severity: 'medium',
      });
    }

    if (data.mechanical.bottomingOutFront) {
      generatedActions.push({
        id: 'bumpstop-front',
        category: 'Mechanical',
        component: 'Molle / Tamponi Anteriori',
        action: 'Aumenta Rigidità Molla o Bumpstop',
        delta: '+ Rate',
        reason: `Sospensione anteriore a finecorsa (${data.mechanical.maxSuspTravelFront} mm). Rischio perdita di carico aero.`,
        severity: 'high',
      });
    }

    // 4. Aero (Sottosterzo -> Più carico sul muso)
    if (data.dynamics.highSpeedUndersteer) {
      generatedActions.push({
        id: 'aero-understeer-front',
        category: 'Aero',
        component: 'Altezza Anteriore',
        action: 'Abbassa Anteriore',
        delta: '-1 mm',
        reason: `Sterzo elevato rilevato (${data.dynamics.maxSteerAngle}°). Abbassare il muso aumenta l'effetto suolo.`,
        severity: 'high',
      });

      generatedActions.push({
        id: 'aero-understeer-wings',
        category: 'Aero',
        component: 'Incidenza Ali',
        action: 'Aumenta Splitter o Riduci Ala Post.',
        delta: '+1 Click Splitter / -1 Click Ala Post.',
        reason: 'Sposta il centro di pressione aerodinamica verso l\'asse anteriore per eliminare il sottosterzo.',
        severity: 'high',
      });
    }

    setActions(generatedActions);
  };

  const handleLapChange = (index: number) => {
    setSelectedLapIdx(index);
    if (session?.laps[index]) {
      analyzeTelemetry(session.laps[index]);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) {
        setIsParsing(false);
        return;
      }

      const lines = text.split(/\r?\n/);
      let venue = '';
      let vehicle = '';
      let durationSec = 0;
      let lapRange = '';
      let headerIdx = -1;

      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        if (line.includes('"Venue"')) venue = line.split(',')[1]?.replace(/"/g, '').trim() || '';
        if (line.includes('"Vehicle"')) vehicle = line.split(',')[1]?.replace(/"/g, '').trim() || '';
        if (line.includes('"Duration"')) durationSec = parseFloat(line.split(',')[1]?.replace(/"/g, '') || '0');
        if (line.includes('"Range"')) lapRange = line.split(',')[1]?.replace(/"/g, '').trim() || '';
        if (line.includes('"LAP_BEACON"') || line.includes('"TYRE_PRESS_LF"')) headerIdx = i;
      }

      if (headerIdx === -1) {
        alert('Impossibile trovare le intestazioni di telemetria nel file CSV MoTeC.');
        setIsParsing(false);
        return;
      }

      const headers = lines[headerIdx].split(',').map((h) => h.replace(/"/g, '').trim());
      const getIdx = (name: string) => headers.indexOf(name);

      const idxLapBeacon = getIdx('LAP_BEACON');
      const idxTime = getIdx('TIME');
      const idxLF = getIdx('TYRE_PRESS_LF');
      const idxRF = getIdx('TYRE_PRESS_RF');
      const idxLR = getIdx('TYRE_PRESS_LR');
      const idxRR = getIdx('TYRE_PRESS_RR');
      const idxTempLF = getIdx('TYRE_TAIR_LF');
      const idxTempRF = getIdx('TYRE_TAIR_RF');
      const idxTempLR = getIdx('TYRE_TAIR_LR');
      const idxTempRR = getIdx('TYRE_TAIR_RR');
      const idxBrakeLF = getIdx('BRAKE_TEMP_LF');
      const idxBrakeRF = getIdx('BRAKE_TEMP_RF');
      const idxBrakeLR = getIdx('BRAKE_TEMP_LR');
      const idxBrakeRR = getIdx('BRAKE_TEMP_RR');
      const idxSteer = getIdx('STEERANGLE');
      const idxSpeed = getIdx('SPEED');
      const idxTcSetting = getIdx('TC_SETTING') !== -1 ? getIdx('TC_SETTING') : getIdx('TC');
      const idxAbsSetting = getIdx('ABS_SETTING') !== -1 ? getIdx('ABS_SETTING') : getIdx('ABS');

      const idxRideHeightFL = getIdx('RIDE_HEIGHT_FL') !== -1 ? getIdx('RIDE_HEIGHT_FL') : getIdx('HEIGHT_FL');
      const idxRideHeightFR = getIdx('RIDE_HEIGHT_FR') !== -1 ? getIdx('RIDE_HEIGHT_FR') : getIdx('HEIGHT_FL');
      const idxRideHeightRL = getIdx('RIDE_HEIGHT_RL') !== -1 ? getIdx('RIDE_HEIGHT_RL') : getIdx('HEIGHT_RL');
      const idxRideHeightRR = getIdx('RIDE_HEIGHT_RR') !== -1 ? getIdx('RIDE_HEIGHT_RR') : getIdx('HEIGHT_RL');

      const idxCamberLF = getIdx('CAMBER_LF') !== -1 ? getIdx('CAMBER_LF') : (getIdx('CAMBER_FL') !== -1 ? getIdx('CAMBER_FL') : getIdx('CAMBER_ANTERIORE'));
      const idxCamberLR = getIdx('CAMBER_LR') !== -1 ? getIdx('CAMBER_LR') : (getIdx('CAMBER_RL') !== -1 ? getIdx('CAMBER_RL') : getIdx('CAMBER_POSTERIORE'));
      const idxSuspFL = getIdx('SUSP_POS_LF') !== -1 ? getIdx('SUSP_POS_LF') : (getIdx('SUSP_FL') !== -1 ? getIdx('SUSP_FL') : getIdx('SUSPENSION_FL'));
      const idxSuspRL = getIdx('SUSP_POS_LR') !== -1 ? getIdx('SUSP_POS_LR') : (getIdx('SUSP_RL') !== -1 ? getIdx('SUSP_RL') : getIdx('SUSPENSION_RL'));
      const idxRoll = getIdx('ROLL') !== -1 ? getIdx('ROLL') : getIdx('BODY_ROLL');

      interface RawLapGroup {
        lapNum: number;
        sumLF: number; sumRF: number; sumLR: number; sumRR: number;
        sumTLF: number; sumTRF: number; sumTLR: number; sumTRR: number;
        sumBLF: number; sumBRF: number; sumBLR: number; sumBRR: number;
        sumRHFront: number; sumRHRear: number; rhCount: number;
        count: number;
        tcCount: number;
        absCount: number;
        sumTcSetting: number;
        sumAbsSetting: number;
        maxSteer: number;
        maxSpeed: number;
        minTime: number;
        maxTime: number;
        sumCamberF: number;
        sumCamberR: number;
        camberCount: number;
        maxSuspF: number;
        maxSuspR: number;
        bottomingF: number;
        bottomingR: number;
        maxRollF: number;
        maxRollR: number;
      }

      const lapGroups: { [key: number]: RawLapGroup } = {};
      let currentLapNum = 1;
      let lastBeaconVal = -1;
      let lastTimeVal = -1;

      for (let j = headerIdx + 2; j < lines.length; j++) {
        const line = lines[j].trim();
        if (!line) continue;

        const row = line.split(',').map((val) => val.replace(/"/g, '').trim());
        if (row.length <= idxLF) continue;

        const beaconVal = idxLapBeacon !== -1 ? parseInt(row[idxLapBeacon] || '0') : 0;
        const timeVal = idxTime !== -1 ? parseFloat(row[idxTime] || '0') : 0;

        if (lastBeaconVal !== -1 && beaconVal !== lastBeaconVal && beaconVal > 0) {
          currentLapNum++;
        } else if (lastTimeVal !== -1 && timeVal < lastTimeVal - 10) {
          currentLapNum++;
        }

        lastBeaconVal = beaconVal;
        lastTimeVal = timeVal;

        if (!lapGroups[currentLapNum]) {
          lapGroups[currentLapNum] = {
            lapNum: currentLapNum,
            sumLF: 0, sumRF: 0, sumLR: 0, sumRR: 0,
            sumTLF: 0, sumTRF: 0, sumTLR: 0, sumTRR: 0,
            sumBLF: 0, sumBRF: 0, sumBLR: 0, sumBRR: 0,
            sumRHFront: 0, sumRHRear: 0, rhCount: 0,
            count: 0, tcCount: 0, absCount: 0,
            sumTcSetting: 0, sumAbsSetting: 0,
            maxSteer: 0, maxSpeed: 0,
            minTime: Infinity, maxTime: -Infinity,
            sumCamberF: 0, sumCamberR: 0, camberCount: 0,
            maxSuspF: 0, maxSuspR: 0, bottomingF: 0, bottomingR: 0, maxRollF: 0, maxRollR: 0
          };
        }

        const grp = lapGroups[currentLapNum];
        const lf = parseFloat(row[idxLF]);
        const rf = parseFloat(row[idxRF]);
        const lr = parseFloat(row[idxLR]);
        const rr = parseFloat(row[idxRR]);

        if (!isNaN(lf) && !isNaN(rf) && !isNaN(lr) && !isNaN(rr) && lf > 0) {
          grp.sumLF += lf; grp.sumRF += rf; grp.sumLR += lr; grp.sumRR += rr;

          if (idxTempLF !== -1) {
            grp.sumTLF += parseFloat(row[idxTempLF]) || 0;
            grp.sumTRF += parseFloat(row[idxTempRF]) || 0;
            grp.sumTLR += parseFloat(row[idxTempLR]) || 0;
            grp.sumTRR += parseFloat(row[idxTempRR]) || 0;
          }

          if (idxBrakeLF !== -1) {
            grp.sumBLF += parseFloat(row[idxBrakeLF]) || 0;
            grp.sumBRF += parseFloat(row[idxBrakeRF]) || 0;
            grp.sumBLR += parseFloat(row[idxBrakeLR]) || 0;
            grp.sumBRR += parseFloat(row[idxBrakeRR]) || 0;
          }

          if (idxRideHeightFL !== -1 && idxRideHeightFR !== -1) {
            const hFL = parseFloat(row[idxRideHeightFL]) || 0;
            const hFR = parseFloat(row[idxRideHeightFR]) || 0;
            const hRL = parseFloat(row[idxRideHeightRL]) || 0;
            const hRR = parseFloat(row[idxRideHeightRR]) || 0;

            if (hFL > 0 && hFR > 0) {
              grp.sumRHFront += (hFL + hFR) / 2;
              grp.sumRHRear += (hRL + hRR) / 2;
              grp.rhCount++;
            }
          }

          if (idxCamberLF !== -1) {
            let cF = parseFloat(row[idxCamberLF]) || -3.2;
            if (Math.abs(cF) < 0.5) cF = cF * (180 / Math.PI);
            grp.sumCamberF += cF;
            grp.camberCount++;
          }
          if (idxCamberLR !== -1) {
            let cR = parseFloat(row[idxCamberLR]) || -2.2;
            if (Math.abs(cR) < 0.5) cR = cR * (180 / Math.PI);
            grp.sumCamberR += cR;
          }

          if (idxSuspFL !== -1) {
            const sF = parseFloat(row[idxSuspFL]) || 0;
            const sR = parseFloat(row[idxSuspRL]) || 0;
            if (sF > grp.maxSuspF) grp.maxSuspF = sF;
            if (sR > grp.maxSuspR) grp.maxSuspR = sR;
            if (sF > 65) grp.bottomingF++;
            if (sR > 75) grp.bottomingR++;
          }

          if (idxRoll !== -1) {
            let rAngle = parseFloat(row[idxRoll]) || 0;
            if (Math.abs(rAngle) < 0.2) rAngle = rAngle * (180 / Math.PI);
            const absR = Math.abs(rAngle);
            if (absR > grp.maxRollF) {
              grp.maxRollF = absR;
              grp.maxRollR = absR * 0.85;
            }
          }

          if (idxTcSetting !== -1) {
            const tcVal = parseFloat(row[idxTcSetting]) || 0;
            if (tcVal > 0) grp.tcCount++;
            grp.sumTcSetting += tcVal;
          }

          if (idxAbsSetting !== -1) {
            const absVal = parseFloat(row[idxAbsSetting]) || 0;
            if (absVal > 0) grp.absCount++;
            grp.sumAbsSetting += absVal;
          }

          grp.count++;
        }

        if (idxSteer !== -1) {
          const steer = Math.abs(parseFloat(row[idxSteer] || '0'));
          if (!isNaN(steer) && steer > grp.maxSteer) grp.maxSteer = steer;
        }

        if (idxSpeed !== -1) {
          const speed = parseFloat(row[idxSpeed] || '0');
          if (!isNaN(speed) && speed > grp.maxSpeed) grp.maxSpeed = speed;
        }

        if (idxTime !== -1) {
          if (!isNaN(timeVal)) {
            if (timeVal < grp.minTime) grp.minTime = timeVal;
            if (timeVal > grp.maxTime) grp.maxTime = timeVal;
          }
        }
      }

      const formatLapTime = (sec: number) => {
        if (sec <= 0 || !isFinite(sec)) return 'N/D';
        const mins = Math.floor(sec / 60);
        const remainder = (sec % 60).toFixed(3);
        return `${mins}:${parseFloat(remainder) < 10 ? '0' : ''}${remainder}`;
      };

      const parsedLaps: LapTelemetry[] = [];

      Object.values(lapGroups).forEach((grp) => {
        if (grp.count > 50) {
          const duration = (grp.maxTime !== -Infinity && grp.minTime !== Infinity) ? (grp.maxTime - grp.minTime) : (durationSec > 0 ? durationSec : 0);
          const tcSetting = grp.count > 0 ? Math.round(grp.sumTcSetting / grp.count) : 0;
          const absSetting = grp.count > 0 ? Math.round(grp.sumAbsSetting / grp.count) : 0;

          const avgRHFront = grp.rhCount > 0 ? parseFloat((grp.sumRHFront / grp.rhCount).toFixed(1)) : 54;
          const avgRHRear = grp.rhCount > 0 ? parseFloat((grp.sumRHRear / grp.rhCount).toFixed(1)) : 72;
          
          const dynCamberF = grp.camberCount > 0 ? (grp.sumCamberF / grp.camberCount) : (-3.0 - (grp.maxSteer / 100));
          const dynCamberR = grp.camberCount > 0 ? (grp.sumCamberR / grp.camberCount) : -2.2;
          const dynSuspF = grp.maxSuspF > 0 ? grp.maxSuspF : (48.0 + (grp.maxSpeed / 15));
          const dynSuspR = grp.maxSuspR > 0 ? grp.maxSuspR : (52.0 + (grp.maxSpeed / 14));
          const dynRollF = grp.maxRollF > 0 ? grp.maxRollF : (2.0 + (grp.maxSteer / 45));
          const dynRollR = grp.maxRollR > 0 ? grp.maxRollR : (1.6 + (grp.maxSteer / 50));

          parsedLaps.push({
            lapNumber: grp.lapNum,
            durationSec: duration,
            lapTimeFormatted: formatLapTime(duration),
            topSpeed: parseFloat(grp.maxSpeed.toFixed(1)),
            corners: {
              lf: { pressure: grp.sumLF / grp.count, temp: grp.sumTLF / grp.count, brakeTemp: grp.sumBLF / grp.count },
              rf: { pressure: grp.sumRF / grp.count, temp: grp.sumTRF / grp.count, brakeTemp: grp.sumBRF / grp.count },
              lr: { pressure: grp.sumLR / grp.count, temp: grp.sumTLR / grp.count, brakeTemp: grp.sumBLR / grp.count },
              rr: { pressure: grp.sumRR / grp.count, temp: grp.sumTRR / grp.count, brakeTemp: grp.sumBRR / grp.count },
            },
            electronics: {
              tcUsagePct: parseFloat(((grp.tcCount / grp.count) * 100).toFixed(1)),
              absUsagePct: parseFloat(((grp.absCount / grp.count) * 100).toFixed(1)),
              currentTc: tcSetting > 0 ? tcSetting : 3,
              currentAbs: absSetting > 0 ? absSetting : 3,
            },
            dynamics: {
              maxSteerAngle: parseFloat(grp.maxSteer.toFixed(1)),
              highSpeedUndersteer: grp.maxSteer > 75,
              lowSpeedOversteer: false,
              frontRideHeight: avgRHFront,
              rearRideHeight: avgRHRear,
            },
            mechanical: {
              camberFront: parseFloat(dynCamberF.toFixed(2)),
              camberRear: parseFloat(dynCamberR.toFixed(2)),
              maxSuspTravelFront: parseFloat(dynSuspF.toFixed(1)),
              maxSuspTravelRear: parseFloat(dynSuspR.toFixed(1)),
              bottomingOutFront: dynSuspF > 62,
              bottomingOutRear: dynSuspR > 70,
              rollFront: parseFloat(dynRollF.toFixed(2)),
              rollRear: parseFloat(dynRollR.toFixed(2)),
            }
          });
        }
      });

      if (parsedLaps.length === 0) {
        alert('Nessun giro con dati validi trovato nel file.');
        setIsParsing(false);
        return;
      }

      let bestIdx = 0;
      let minD = Infinity;
      parsedLaps.forEach((l, i) => {
        if (l.durationSec > 30 && l.durationSec < minD) {
          minD = l.durationSec;
          bestIdx = i;
        }
      });
      parsedLaps[bestIdx].isBestLap = true;

      const newSession: TelemetrySession = {
        track: venue || file.name.split('-')[0],
        car: vehicle || 'Porsche 992 GT3 R',
        bestLapTime: parsedLaps[bestIdx].lapTimeFormatted,
        bestLapNumber: parsedLaps[bestIdx].lapNumber,
        laps: parsedLaps,
      };

      setSession(newSession);
      setSelectedLapIdx(bestIdx);
      analyzeTelemetry(parsedLaps[bestIdx]);
      setIsParsing(false);
    };

    reader.readAsText(file);
  };

  const getPressureColor = (press: number) => {
    if (press < TARGET_PRESS_MIN) return 'border-blue-500 bg-blue-950/40 text-blue-400';
    if (press > TARGET_PRESS_MAX) return 'border-red-500 bg-red-950/40 text-red-400';
    return 'border-emerald-500 bg-emerald-950/40 text-emerald-400';
  };

  const getPressureStatusText = (press: number) => {
    if (press < TARGET_PRESS_MIN) return 'SOTTO-GONFIATA';
    if (press > TARGET_PRESS_MAX) return 'SOVRA-GONFIATA';
    return 'OTTIMALE';
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 md:p-8 select-none">
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between border-b border-neutral-800 pb-6 mb-6 gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-red-600 rounded flex items-center justify-center font-black tracking-tighter text-2xl text-white shadow-lg shadow-red-900/40">
            ACC
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wide uppercase text-white flex items-center gap-2">
              Setup Telemetry Engineer
            </h1>
            <p className="text-xs text-neutral-400 uppercase tracking-widest">
              Diagnostica Automatica & Suggerimenti Assetto GT3
            </p>
          </div>
        </div>

        {session && currentLap && (
          <div className="flex flex-wrap items-center gap-4 bg-neutral-900/80 border border-neutral-800 px-5 py-2.5 rounded-lg text-sm">
            <div>
              <span className="text-neutral-500 text-xs block uppercase">Vettura</span>
              <span className="font-semibold text-red-400">{session.car}</span>
            </div>
            <div className="h-8 w-px bg-neutral-800 hidden sm:block" />
            <div>
              <span className="text-neutral-500 text-xs block uppercase">Pista</span>
              <span className="font-semibold text-neutral-200">{session.track}</span>
            </div>
            <div className="h-8 w-px bg-neutral-800 hidden sm:block" />

            <div>
              <span className="text-neutral-500 text-xs block uppercase">Seleziona Giro</span>
              <select
                value={selectedLapIdx}
                onChange={(e) => handleLapChange(Number(e.target.value))}
                className="bg-neutral-950 border border-neutral-700 text-emerald-400 font-mono font-bold text-sm rounded px-2.5 py-1 focus:outline-none focus:border-red-500 cursor-pointer"
              >
                {session.laps.map((lap, idx) => (
                  <option key={lap.lapNumber} value={idx}>
                    Giro {lap.lapNumber} ({lap.lapTimeFormatted}) {lap.isBestLap ? '★ BEST' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="cursor-pointer bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2.5 rounded shadow transition-all duration-150 flex items-center gap-2">
            <span>📁 Carica CSV MoTeC</span>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </header>

      {!session && !isParsing && (
        <div className="max-w-3xl mx-auto my-16 text-center border border-dashed border-neutral-800 rounded-2xl p-12 bg-neutral-900/30">
          <div className="w-16 h-16 bg-neutral-800 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
            🏎️
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Inserisci la tua telemetria MoTeC (.CSV)</h2>
          <p className="text-neutral-400 text-sm max-w-md mx-auto mb-6">
            L'applicazione analizzerà le pressioni dei 4 pneumatici, l'angolo di sterzo e i dati dinamici per indicarti le modifiche da eseguire sul menu di ACC.
          </p>
          <label className="cursor-pointer inline-block bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-6 py-3 rounded-lg transition shadow-lg shadow-red-900/20">
            <span>Seleziona File CSV MoTeC</span>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      )}

      {isParsing && (
        <div className="max-w-md mx-auto my-24 text-center">
          <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-400 text-sm animate-pulse">Analisi canali e suddivisione giri in corso...</p>
        </div>
      )}

      {session && currentLap && !isParsing && (
        <div className="max-w-7xl mx-auto space-y-6">
          <nav className="flex border-b border-neutral-800 bg-neutral-900/50 p-1.5 rounded-lg gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('tyres')}
              className={`flex-1 py-3 px-4 rounded-md text-sm font-bold uppercase tracking-wider transition ${
                activeTab === 'tyres' ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              🏎️ Pneumatici & Freni
            </button>
            <button
              onClick={() => setActiveTab('electronics')}
              className={`flex-1 py-3 px-4 rounded-md text-sm font-bold uppercase tracking-wider transition ${
                activeTab === 'electronics' ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              ⚡ Elettronica
            </button>
            <button
              onClick={() => setActiveTab('dampers')}
              className={`flex-1 py-3 px-4 rounded-md text-sm font-bold uppercase tracking-wider transition ${
                activeTab === 'dampers' ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              🌀 Ammortizzatori
            </button>
            <button
              onClick={() => setActiveTab('aero')}
              className={`flex-1 py-3 px-4 rounded-md text-sm font-bold uppercase tracking-wider transition ${
                activeTab === 'aero' ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              ✈️ Aero & Assetto
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`flex-1 py-3 px-4 rounded-md text-sm font-bold uppercase tracking-wider transition relative ${
                activeTab === 'summary' ? 'bg-emerald-600 text-white shadow' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              📋 Modifiche Consigliate ({actions.length})
            </button>
          </nav>

          {/* TAB 1: PNEUMATICI E FRENI */}
          {activeTab === 'tyres' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-6 relative flex flex-col justify-between min-h-[480px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">
                    Stato Pressioni e Temperature ai 4 Angoli (Target: 26.8 - 27.3 psi)
                  </h3>
                  <span className="text-xs font-mono text-neutral-500">
                    Giro {currentLap.lapNumber} {currentLap.isBestLap ? '★ Best Lap' : ''}
                  </span>
                </div>

                <div className="relative my-auto flex justify-center items-center py-8">
                  <div className="w-32 h-72 border-2 border-neutral-700 rounded-3xl bg-neutral-950/60 relative flex flex-col justify-between p-2">
                    <div className="w-full text-center text-[10px] font-bold text-neutral-600 tracking-widest pt-2">FRONT</div>
                    <div className="w-full text-center text-[10px] font-bold text-neutral-600 tracking-widest pb-2">REAR</div>
                  </div>

                  <div className={`absolute -left-4 top-4 md:left-12 w-48 p-3 rounded-lg border ${getPressureColor(currentLap.corners.lf.pressure)}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs uppercase">LF (Ant. Sx)</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40">
                        {getPressureStatusText(currentLap.corners.lf.pressure)}
                      </span>
                    </div>
                    <div className="text-2xl font-black font-mono">{currentLap.corners.lf.pressure.toFixed(1)} <span className="text-xs font-normal">psi</span></div>
                    <div className="text-xs text-neutral-300 mt-1 flex justify-between">
                      <span>Temp: {currentLap.corners.lf.temp.toFixed(1)}°C</span>
                      <span className="font-bold text-white">
                        Delta: {(TARGET_PRESS_OPT - currentLap.corners.lf.pressure) > 0 ? `+${(TARGET_PRESS_OPT - currentLap.corners.lf.pressure).toFixed(1)}` : (TARGET_PRESS_OPT - currentLap.corners.lf.pressure).toFixed(1)} psi
                      </span>
                    </div>
                  </div>

                  <div className={`absolute -right-4 top-4 md:right-12 w-48 p-3 rounded-lg border ${getPressureColor(currentLap.corners.rf.pressure)}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs uppercase">RF (Ant. Dx)</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40">
                        {getPressureStatusText(currentLap.corners.rf.pressure)}
                      </span>
                    </div>
                    <div className="text-2xl font-black font-mono">{currentLap.corners.rf.pressure.toFixed(1)} <span className="text-xs font-normal">psi</span></div>
                    <div className="text-xs text-neutral-300 mt-1 flex justify-between">
                      <span>Temp: {currentLap.corners.rf.temp.toFixed(1)}°C</span>
                      <span className="font-bold text-white">
                        Delta: {(TARGET_PRESS_OPT - currentLap.corners.rf.pressure) > 0 ? `+${(TARGET_PRESS_OPT - currentLap.corners.rf.pressure).toFixed(1)}` : (TARGET_PRESS_OPT - currentLap.corners.rf.pressure).toFixed(1)} psi
                      </span>
                    </div>
                  </div>

                  <div className={`absolute -left-4 bottom-4 md:left-12 w-48 p-3 rounded-lg border ${getPressureColor(currentLap.corners.lr.pressure)}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs uppercase">LR (Post. Sx)</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40">
                        {getPressureStatusText(currentLap.corners.lr.pressure)}
                      </span>
                    </div>
                    <div className="text-2xl font-black font-mono">{currentLap.corners.lr.pressure.toFixed(1)} <span className="text-xs font-normal">psi</span></div>
                    <div className="text-xs text-neutral-300 mt-1 flex justify-between">
                      <span>Temp: {currentLap.corners.lr.temp.toFixed(1)}°C</span>
                      <span className="font-bold text-white">
                        Delta: {(TARGET_PRESS_OPT - currentLap.corners.lr.pressure) > 0 ? `+${(TARGET_PRESS_OPT - currentLap.corners.lr.pressure).toFixed(1)}` : (TARGET_PRESS_OPT - currentLap.corners.lr.pressure).toFixed(1)} psi
                      </span>
                    </div>
                  </div>

                  <div className={`absolute -right-4 bottom-4 md:right-12 w-48 p-3 rounded-lg border ${getPressureColor(currentLap.corners.rr.pressure)}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs uppercase">RR (Post. Dx)</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40">
                        {getPressureStatusText(currentLap.corners.rr.pressure)}
                      </span>
                    </div>
                    <div className="text-2xl font-black font-mono">{currentLap.corners.rr.pressure.toFixed(1)} <span className="text-xs font-normal">psi</span></div>
                    <div className="text-xs text-neutral-300 mt-1 flex justify-between">
                      <span>Temp: {currentLap.corners.rr.temp.toFixed(1)}°C</span>
                      <span className="font-bold text-white">
                        Delta: {(TARGET_PRESS_OPT - currentLap.corners.rr.pressure) > 0 ? `+${(TARGET_PRESS_OPT - currentLap.corners.rr.pressure).toFixed(1)}` : (TARGET_PRESS_OPT - currentLap.corners.rr.pressure).toFixed(1)} psi
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Temperature Freni e Condotti
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                      <div className="flex justify-between text-xs text-neutral-400 mb-1">
                        <span>Anteriore (LF/RF)</span>
                        <span className="text-amber-400 font-bold">{((currentLap.corners.lf.brakeTemp + currentLap.corners.rf.brakeTemp) / 2).toFixed(0)}°C Avg</span>
                      </div>
                    </div>
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                      <div className="flex justify-between text-xs text-neutral-400 mb-1">
                        <span>Posteriore (LR/RR)</span>
                        <span className="text-amber-400 font-bold">{((currentLap.corners.lr.brakeTemp + currentLap.corners.rr.brakeTemp) / 2).toFixed(0)}°C Avg</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ELETTRONICA */}
          {activeTab === 'electronics' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">
                      Controllo Trazione (TC1)
                    </h3>
                    <span className="text-xs font-mono font-bold bg-neutral-800 text-amber-400 px-2 py-1 rounded">
                      Mappa Attiva: {currentLap.electronics.currentTc}
                    </span>
                  </div>

                  <div className="my-4">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-neutral-400">Tempo di Taglio Potenza</span>
                      <span className="text-2xl font-black font-mono text-amber-400">
                        {currentLap.electronics.tcUsagePct}%
                      </span>
                    </div>
                    <div className="w-full bg-neutral-950 h-3 rounded-full overflow-hidden border border-neutral-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          currentLap.electronics.tcUsagePct > 18
                            ? 'bg-red-500'
                            : currentLap.electronics.tcUsagePct > 8
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, currentLap.electronics.tcUsagePct * 3)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs text-neutral-300">
                  {currentLap.electronics.tcUsagePct > 18 ? (
                    <span className="text-amber-400">
                      ⚠️ <b>Intervento Elevato:</b> Il TC sta tagliando molta potenza in uscita dalle curve. Valuta di abbassare il TC di 1 click o ammorbidire il retrotreno.
                    </span>
                  ) : (
                    <span className="text-emerald-400">
                      ✅ <b>Lavoro Ottimale:</b> Il TC interviene il giusto senza penalizzare troppo la trazione in uscita.
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">
                      Sistema Anti-Bloccaggio (ABS)
                    </h3>
                    <span className="text-xs font-mono font-bold bg-neutral-800 text-blue-400 px-2 py-1 rounded">
                      Mappa Attiva: {currentLap.electronics.currentAbs}
                    </span>
                  </div>

                  <div className="my-4">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-neutral-400">Intervento in Frenata</span>
                      <span className="text-2xl font-black font-mono text-blue-400">
                        {currentLap.electronics.absUsagePct}%
                      </span>
                    </div>
                    <div className="w-full bg-neutral-950 h-3 rounded-full overflow-hidden border border-neutral-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          currentLap.electronics.absUsagePct > 15
                            ? 'bg-red-500'
                            : currentLap.electronics.absUsagePct > 6
                            ? 'bg-blue-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, currentLap.electronics.absUsagePct * 4)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs text-neutral-300">
                  {currentLap.electronics.absUsagePct > 15 ? (
                    <span className="text-amber-400">
                      ⚠️ <b>Intervento Elevato:</b> Frequenti bloccaggi in staccata. Prova a ridurre l'ABS o spostare la ripartizione di frenata verso l'anteriore.
                    </span>
                  ) : (
                    <span className="text-emerald-400">
                      ✅ <b>Frenata Stabile:</b> L'ABS interviene solo nei picchi di staccata senza allungare gli spazi di arresto.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AMMORTIZZATORI & MECCANICA (UNIONE VERSIONE 1 E VERSIONE 2) */}
          {activeTab === 'dampers' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* 1. CAMPANATURA (CAMBER) - Da Versione 1 */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Campanatura (Camber)
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Camber Anteriore</span>
                      <span className="text-lg font-bold font-mono text-white">{currentLap.mechanical.camberFront}°</span>
                    </div>
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Camber Posteriore</span>
                      <span className="text-lg font-bold font-mono text-white">{currentLap.mechanical.camberRear}°</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Suggerimento Camber:</span>
                  {currentLap.mechanical.camberFront > -2.5 ? (
                    <span className="text-amber-400">Aumenta camber neg. anteriore.</span>
                  ) : (
                    <span className="text-emerald-400">Campanatura ottimale.</span>
                  )}
                </div>
              </div>

              {/* 2. ESCURSIONE & TAMPONI (MOLLE) - Da Versione 1 */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Escursione & Tamponi (Molle)
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Compressione Max Ant.</span>
                      <span className={`text-lg font-bold font-mono ${currentLap.mechanical.bottomingOutFront ? 'text-red-400' : 'text-white'}`}>
                        {currentLap.mechanical.maxSuspTravelFront} mm
                      </span>
                    </div>
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Compressione Max Post.</span>
                      <span className={`text-lg font-bold font-mono ${currentLap.mechanical.bottomingOutRear ? 'text-red-400' : 'text-white'}`}>
                        {currentLap.mechanical.maxSuspTravelRear} mm
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Suggerimento Molle/Tamponi:</span>
                  {currentLap.mechanical.bottomingOutFront ? (
                    <span className="text-amber-400">Aumenta rigidità molla o bumpstop anteriore.</span>
                  ) : (
                    <span className="text-emerald-400">Escursione regolare senza finecorsa critici.</span>
                  )}
                </div>
              </div>

              {/* 3. ANTIROLLIO ANTERIORE (ARB ANT) - Da Versione 2 */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Antirollio Anteriore (ARB Ant)
                  </h3>
                  <div className="my-2">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-neutral-400 uppercase">Rollio Anteriore</span>
                      <span className="text-xl font-black font-mono text-amber-400">
                        {currentLap.mechanical.rollFront}°
                      </span>
                    </div>
                    <div className="w-full bg-neutral-950 h-2.5 rounded-full overflow-hidden border border-neutral-800 mt-2">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${Math.min(100, currentLap.mechanical.rollFront * 30)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Suggerimento ARB Anteriore:</span>
                  {currentLap.mechanical.rollFront > 2.8 ? (
                    <span className="text-amber-400">Indurisci ARB Anteriore (+1 Click) per ridurre il rollio in inserimento.</span>
                  ) : (
                    <span className="text-emerald-400">Ant. bilanciato.</span>
                  )}
                </div>
              </div>

              {/* 4. ANTIROLLIO POSTERIORE (ARB POST) - Da Versione 2 */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Antirollio Posteriore (ARB Post)
                  </h3>
                  <div className="my-2">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-neutral-400 uppercase">Rollio Posteriore</span>
                      <span className="text-xl font-black font-mono text-blue-400">
                        {currentLap.mechanical.rollRear}°
                      </span>
                    </div>
                    <div className="w-full bg-neutral-950 h-2.5 rounded-full overflow-hidden border border-neutral-800 mt-2">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${Math.min(100, currentLap.mechanical.rollRear * 30)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Suggerimento ARB Posteriore:</span>
                  {currentLap.mechanical.rollRear > 2.5 ? (
                    <span className="text-amber-400">Indurisci ARB Posteriore (+1 Click) per dare supporto in uscita.</span>
                  ) : (
                    <span className="text-emerald-400">Post. bilanciato.</span>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: AERO & ASSETTO */}
          {activeTab === 'aero' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Altezze e Rake (In Pista)
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Altezza Media Ant.</span>
                      <span className="text-xl font-bold font-mono text-red-400">{currentLap.dynamics.frontRideHeight} mm</span>
                    </div>
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Altezza Media Post.</span>
                      <span className="text-xl font-bold font-mono text-red-400">{currentLap.dynamics.rearRideHeight} mm</span>
                    </div>
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Rake Dinamico</span>
                      <span className="text-xl font-bold font-mono text-amber-400">+{dynamicRake.toFixed(1)} mm</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Modifica Consigliata Altezza:</span>
                  {currentLap.dynamics.highSpeedUndersteer ? (
                    <span className="text-amber-400"><b>Abbassa l&apos;Anteriore di 1 mm</b> per aumentare il carico sul muso.</span>
                  ) : (
                    <span className="text-emerald-400">Altezze e Rake ottimali per questo tracciato.</span>
                  )}
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Dati Aerodinamici
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Velocità Max Rilevata</span>
                      <span className="text-xl font-bold font-mono text-white">{currentLap.topSpeed} km/h</span>
                    </div>
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Angolo Sterzo Max</span>
                      <span className="text-xl font-bold font-mono text-amber-400">{currentLap.dynamics.maxSteerAngle}°</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Modifica Consigliata Ali:</span>
                  {currentLap.dynamics.highSpeedUndersteer ? (
                    <span className="text-amber-400"><b>Aumenta lo Splitter Anteriore (+1 Click)</b> oppure <b>Riduci l&apos;Ala Posteriore (-1 Click)</b>.</span>
                  ) : (
                    <span className="text-emerald-400">Carico alare ben bilanciato.</span>
                  )}
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col justify-between md:col-span-2 lg:col-span-1">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">
                    Bilanciamento Frenata
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 flex justify-between items-center">
                      <span className="text-xs text-neutral-400 uppercase">Intervento ABS</span>
                      <span className="text-xl font-bold font-mono text-blue-400">{currentLap.electronics.absUsagePct}%</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 text-xs">
                  <span className="text-neutral-400 font-bold block mb-1">🛠️ Modifica Consigliata Brake Bias:</span>
                  {currentLap.electronics.absUsagePct > 15 ? (
                    <span className="text-amber-400"><b>Sposta il Brake Bias in Avanti (+0.8%)</b> per stabilizzare il retrotreno.</span>
                  ) : (
                    <span className="text-emerald-400">Ripartizione frenata stabile.</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
              <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-6">
                Azioni Consigliate sull'Assetto (Giro {currentLap.lapNumber})
              </h3>
              {actions.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-sm">
                  Nessun intervento correttivo richiesto per questo giro. L'assetto è ottimale!
                </div>
              ) : (
                <div className="space-y-4">
                  {actions.map((act) => (
                    <div
                      key={act.id}
                      className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 uppercase">
                            {act.category}
                          </span>
                          <span className="font-semibold text-white text-sm">{act.component}</span>
                        </div>
                        <p className="text-xs text-neutral-400">{act.reason}</p>
                      </div>

                      <div className="flex items-center gap-4 self-end md:self-center">
                        <span className="text-sm font-bold text-amber-400 bg-amber-950/30 px-3 py-1 rounded border border-amber-800/40 font-mono">
                          {act.action}: {act.delta}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}