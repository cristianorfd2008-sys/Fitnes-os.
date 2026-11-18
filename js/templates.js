// Modelos de programa do FITNESS OS. Contêm só exercícios e parâmetros (sem dados pessoais).
// Fonte de verdade do conteúdo: training/PROGRAM.md. Mantenha os dois iguais (teste em tests/unit/templates.test.js).

const it = (exerciseId, sets, repMin, repMax, rir, restSec, notes = '') => ({ exerciseId, sets, repMin, repMax, rir, restSec, notes });
const SHOULDER = 'Registre a dor do ombro (0–10). 3 = reduza carga/amplitude; 4+ = troque pela alternativa.';

export const TEMPLATES = [
  {
    key: 'fos-v1',
    name: 'FITNESS OS v1 — Superior/Inferior',
    description: '4x/semana, ~1 h. Semanas 1–2 com RIR 3; depois o RIR indicado. Cuidado com os ombros (ver PROGRAM.md).',
    days: [
      { name: 'Superior A', items: [
        it('supino_maquina', 3, 8, 12, 2, 120, `Escápulas para trás; pare antes de o ombro projetar à frente. ${SHOULDER}`),
        it('puxada_frente', 3, 8, 12, 2, 120, 'Pegada neutra, se houver. Peito alto, alongue em cima.'),
        it('supino_inclinado_halter', 2, 10, 12, 2, 90, `Banco ~30°, pegada neutra, desça só até onde não dói. ${SHOULDER}`),
        it('remada_apoiada', 3, 10, 12, 2, 90, 'Peito no apoio.'),
        it('elevacao_lateral_cabo', 3, 12, 15, 2, 60, `Leve, até a linha do ombro, sem encolher. ${SHOULDER}`),
        it('rosca_inclinada', 2, 10, 12, 2, 60, 'Bi-set com o tríceps.'),
        it('triceps_polia', 2, 10, 12, 2, 60, 'Bi-set com a rosca.'),
      ] },
      { name: 'Inferior A', items: [
        it('leg_press', 3, 8, 12, 3, 120, 'Desça até onde o quadril não descola.'),
        it('stiff', 3, 8, 10, 3, 120, 'Halteres. Quadril para trás, coluna neutra.'),
        it('cadeira_extensora', 2, 10, 15, 2, 90),
        it('mesa_flexora', 2, 10, 15, 2, 90),
        it('panturrilha_pe', 3, 10, 15, 2, 60, 'Pausa embaixo.'),
        it('abdominal_cabo', 2, 10, 15, 2, 60),
      ] },
      { name: 'Superior B', items: [
        it('puxada_unilateral', 3, 10, 12, 2, 90),
        it('supino_reto_halter', 3, 8, 12, 2, 120, `Cotovelos a ~45–60° do tronco; amplitude sem dor. ${SHOULDER}`),
        it('remada_baixa_cabo', 3, 10, 12, 2, 90),
        it('crucifixo_cabo', 2, 12, 15, 2, 60, `Não passe da linha do tronco se doer. ${SHOULDER}`),
        it('elevacao_lateral', 3, 12, 15, 2, 60, SHOULDER),
        it('crucifixo_inverso', 2, 12, 15, 2, 60),
        it('rosca_cabo', 2, 10, 12, 2, 60, 'Bi-set com o tríceps.'),
        it('triceps_polia', 2, 10, 12, 2, 60, 'Bi-set com a rosca.'),
      ] },
      { name: 'Inferior B', items: [
        it('hack_squat', 3, 8, 12, 3, 120),
        it('hip_thrust', 2, 8, 12, 2, 90, 'Não arqueie a lombar no topo.'),
        it('mesa_flexora', 3, 10, 12, 2, 90, 'Prefira a cadeira flexora (sentado), se houver.'),
        it('panturrilha_sentado', 3, 12, 15, 2, 60),
        it('elevacao_pernas', 2, 10, 15, 2, 60),
        it('rosca_direta', 2, 10, 12, 2, 60, 'Bi-set com o tríceps.'),
        it('triceps_polia', 2, 10, 12, 2, 60, 'Bi-set com a rosca.'),
      ] },
    ],
  },
];
