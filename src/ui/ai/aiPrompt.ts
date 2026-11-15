import { LEGAL_DATES } from '../../domain/legal';
import { AI_FORMAT_ID, AI_FORMAT_VERSION } from './aiFormat';

const br = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Texto que a pessoa copia e cola no ChatGPT, Claude, Gemini etc. A IA entrevista a pessoa,
 * mostra um rascunho da escala e entrega o código no formato de `aiFormat.ts`.
 */
export function buildAiPrompt(today: Date = new Date()): string {
  const hoje = today.toLocaleDateString('pt-BR');
  return `Você vai me ajudar a montar a escala de trabalho 5x2 da minha equipe, seguindo as novas regras da CLT (EC 141/2026). No fim, você vai me entregar um código para eu importar no site "Escala 5x2", onde vou ajustar e exportar a escala.

Hoje é ${hoje}.

# Como conduzir a conversa
- Fale em português do Brasil, de um jeito simples e amigável, sem juridiquês. Sou dono(a) ou gerente de um pequeno negócio.
- Faça poucas perguntas por vez (um bloco por mensagem) e espere minha resposta antes de seguir.
- Se eu não souber responder, sugira um valor comum para o meu ramo e pergunte se pode usar.
- Não invente dados. Para as pessoas, basta o primeiro nome (não peça CPF, telefone nem outros dados pessoais).

# O que perguntar (nesta ordem)
1. Nome do negócio e ramo (mercado, padaria, loja, restaurante...).
2. Dias e horários de funcionamento. Domingo costuma ser diferente.
3. Se em algum dia todo mundo trabalha no mesmo horário da loja (ex.: domingo só de manhã) = "turno único".
   E se há algum dia de muito movimento em que ninguém pode folgar (ex.: sábado) = "sem folga". Domingo não pode ser "sem folga".
4. Regime de horas: 42h por semana (vale de ${br(LEGAL_DATES.start42h)} até 15/12/2027) ou 40h (obrigatório a partir de ${br(LEGAL_DATES.switch40h)}; já pode ser usado antes).
5. Se as 2 folgas da semana devem ficar juntas sempre que possível (ex.: sábado e domingo) ou se podem ser separadas.
6. Turnos: de 1 a 3 (ex.: Manhã e Tarde), com entrada, saída e intervalo de almoço. Se eu não souber, sugira turnos a partir do horário da loja que respeitem o limite diário.
7. Funções (ex.: caixa, atendente, cozinha) e o mínimo de pessoas de cada função em cada turno. O mínimo pode mudar em algum dia (ex.: 2 no sábado, 1 nos outros dias).
8. Equipe: para cada pessoa, nome, função e turno. Pergunte também:
   - se é mulher (muda a regra de folga no domingo);
   - se tem horário próprio, diferente do turno (ex.: entra às 5:45 para fazer o pão);
   - se cobre uma segunda função quando a principal já está completa (ex.: repositor que cobre o caixa);
   - se não tem turno fixo e pode ser posta onde faltar gente.

# Regras da lei (use para orientar e montar o rascunho)
- Escala 5x2: cada pessoa trabalha no máximo 5 dias e folga 2 em toda semana (semana de domingo a sábado). Nunca mais de 6 dias seguidos de trabalho nem mais de 2 folgas seguidas.
- Teto semanal: 42h no regime de 42h; 40h no regime de 40h.
- Limite diário: 8h24 trabalhadas no regime de 42h; 8h no de 40h (acima disso, só com acordo ou convenção coletiva).
  Horas trabalhadas = saída − entrada − intervalo.
- Intervalo: acima de 6h trabalhadas no dia, de 1h a 2h; entre 4h e 6h, 15 minutos.
- Descanso de pelo menos 11h entre um dia de trabalho e o seguinte, e 35h seguidas de descanso na semana.
- Domingo (comércio): cada pessoa folga pelo menos 1 domingo a cada 3 semanas. Mulheres: pelo menos 1 domingo a cada 2 semanas (CLT art. 386), o que num ciclo de 3 semanas significa 2 dos 3 domingos.
- Por isso a escala é um ciclo de 3 semanas que se repete: cada pessoa folga 1 domingo por ciclo (mulheres, 2) e cerca de um terço da equipe folga em cada domingo.

# Antes do código
1. Mostre um resumo de tudo o que eu respondi e pergunte se está certo.
2. Depois que eu confirmar, mostre um RASCUNHO da escala: uma tabela por semana (Semana 1, 2 e 3), com as pessoas nas linhas, os dias de domingo a sábado nas colunas e, em cada célula, o turno ou "Folga". Siga as regras acima.
   Aponte onde falta gente (turno abaixo do mínimo) e sugira como resolver (contratar, mudar alguém de turno ou reduzir o mínimo).
   Avise que é só uma prévia: o site gera a escala oficial ao importar, confere todas as regras e deixa ajustar tudo.

# O código final
Entregue um único bloco de código JSON, exatamente neste formato, sem comentários dentro do código:

\`\`\`json
{
  "formato": "${AI_FORMAT_ID}",
  "versao": ${AI_FORMAT_VERSION},
  "negocio": "Padaria Pão Quente",
  "regime": "42h",
  "folgas": "juntas",
  "funcionamento": {
    "domingo": { "abre": "07:00", "fecha": "13:00", "turnoUnico": true },
    "segunda": { "abre": "06:00", "fecha": "20:00" },
    "terca": { "abre": "06:00", "fecha": "20:00" },
    "quarta": { "abre": "06:00", "fecha": "20:00" },
    "quinta": { "abre": "06:00", "fecha": "20:00" },
    "sexta": { "abre": "06:00", "fecha": "20:00" },
    "sabado": { "abre": "06:00", "fecha": "20:00", "semFolga": true }
  },
  "turnos": [
    { "nome": "Manhã", "entrada": "06:00", "saida": "14:20", "intervaloMin": 60 },
    { "nome": "Tarde", "entrada": "11:40", "saida": "20:00", "intervaloMin": 60 }
  ],
  "funcoes": [
    { "nome": "Atendente", "minimo": { "Manhã": 1, "Tarde": { "padrao": 1, "sabado": 2 } } },
    { "nome": "Padeiro", "minimo": { "Manhã": 1, "Tarde": 0 } }
  ],
  "equipe": [
    { "nome": "Rosa", "funcao": "Padeiro", "turno": "Manhã", "mulher": true, "entrada": "05:45", "saida": "14:05", "intervaloMin": 60 },
    { "nome": "João", "funcao": "Padeiro", "turno": "Manhã", "mulher": false },
    { "nome": "Ana", "funcao": "Atendente", "turno": "Manhã", "mulher": true, "segundaFuncao": "Padeiro" },
    { "nome": "Bia", "funcao": "Atendente", "turno": "Tarde", "mulher": true },
    { "nome": "Caio", "funcao": "Atendente", "turno": "Tarde", "mulher": false, "semTurnoFixo": true }
  ]
}
\`\`\`

Regras do código:
- Horários sempre como "HH:MM" (de "00:00" a "23:59"). "intervaloMin" é o intervalo em minutos.
- "funcionamento": use as chaves domingo, segunda, terca, quarta, quinta, sexta, sabado (sem acento). Dia fechado: não coloque a chave (ou use null). "turnoUnico" e "semFolga" são opcionais (true/false).
- "regime": "42h" ou "40h". "folgas": "juntas" ou "separadas".
- "turnos": de 1 a 3, com nomes diferentes.
- "funcoes": em "minimo", use o nome exato de cada turno. O valor é um número (vale para todos os dias) ou { "padrao": N, "<dia>": N } para mudar em dias específicos. Turno que não aparece no "minimo" fica com 0.
- "equipe": "funcao", "turno" e "segundaFuncao" usam os nomes exatos cadastrados em "funcoes" e "turnos". "mulher" é true ou false.
  "entrada", "saida" e "intervaloMin" da pessoa só quando ela tiver horário próprio. "segundaFuncao" e "semTurnoFixo" são opcionais.
- Não inclua a escala dia a dia no código: o site gera a escala a partir dele.

Depois do código, diga: "Copie o código (o botão de copiar fica no canto do bloco), volte ao site Escala 5x2, abra 'Gerar com IA' e cole no campo de importação."
Se eu voltar com uma mensagem de erro do site, corrija o código e entregue de novo, completo.

Pode começar com a primeira pergunta.`;
}
