# Escala 5x2

Monte a escala 5x2 da sua equipe em minutos, seguindo as novas regras da CLT (EC 141/2026).
Grátis, sem cadastro e sem servidor: tudo roda e fica salvo no seu navegador.

> A EC 141/2026 acaba com a escala 6x1. Todo empregado passa a ter **dois dias de descanso por semana**,
> com teto de **42h semanais** a partir de 16/12/2026 e de **40h** a partir de 16/12/2027.
> No pequeno comércio isso abre buracos na escala, e este site mostra onde eles estão e como fechá-los.

---

## Para quem é

Donos e gerentes de pequenos negócios (de 3 a 30 funcionários) que precisam reorganizar a equipe para a 5x2
sem planilha e sem adivinhar se a escala está dentro da lei.

Na tela inicial dá para abrir um exemplo pronto e explorar: mercado, loja de roupas, padaria, farmácia ou
restaurante, cada um com equipe, turnos e horários típicos do ramo. Depois é só mudar tudo ou apagar.

## O que o site faz

**1. Configuração em quatro passos**
- **Loja:** dias e horário de funcionamento (domingo pode ser diferente), regime de 42h ou 40h e preferência de folgas.
- **Turnos:** de 1 a 3 turnos, sugeridos a partir do horário da loja com a jornada oficial do regime.
- **Funções:** caixa, balconista etc., com o mínimo de pessoas por turno, que pode variar por dia da semana.
- **Equipe:** nome, função e turno de cada pessoa, com horário próprio quando precisar
  (ex.: "a Rosa entra às 5:45 para fazer o pão").

**2. Geração automática**
- Ciclo de **3 semanas que se repete**, com exatamente **2 folgas por semana** para cada pessoa.
- Folgas estáveis (os mesmos dias da semana ao longo do ciclo) e **rodízio de domingo**.
- Quando não dá para cumprir o mínimo, o site entrega a melhor escala possível e marca cada buraco.

**3. Diagnóstico honesto**
- Resumo de cobertura no topo: "Tudo coberto" ou exatamente onde falta gente.
- Sugestões concretas para cada buraco: contratar, mudar alguém de turno ou reduzir o mínimo.
- Buraco pode ser marcado como **"coberto por mim/família"** ou **"coberto por [funcionário]"**.
  No segundo caso, as horas entram na conta da pessoa.

**4. Edição ao vivo**
- Troque folgas, turno e horários direto na tabela. Horas, cobertura e alertas recalculam na hora.
- Visões de **Ciclo**, **Mês** (datas reais, feriados e ajustes só daquela data) e **Dia** (linha do tempo com intervalos).
- Alertas não bloqueiam nada: ficam visíveis até serem resolvidos.

**5. Exportação**
- **Impressão** em folha A4 deitada, legível em preto e branco.
- **Imagem para WhatsApp**, compartilhada direto pelo celular.
- **Escala individual** de cada funcionário, em calendário, para entregar à pessoa.
- **Backup** da configuração em arquivo, para restaurar depois ou em outro aparelho.

## Regras checadas

A cada alteração, o site confere por funcionário:

| Regra | Como é aplicada |
| --- | --- |
| Teto semanal | 42h na transição, 40h a partir de dez/2027 |
| Limite diário | 8h24 no regime de 42h e 8h no de 40h; acima disso, só com acordo ou convenção coletiva |
| Folgas | 2 por semana |
| Intervalo intrajornada | mínimo exigido pela jornada |
| Descanso entre jornadas | 11h (mostrado como aviso, com sugestões de ajuste) |
| Descanso semanal | 35h consecutivas |
| Domingo | folga ao menos 1 a cada 3 semanas; 2 a cada 3 para funcionárias (CLT art. 386) |

> ⚠️ **Ferramenta orientativa.** O site aplica as regras gerais da EC 141/2026 e da CLT. Convenções coletivas e
> casos especiais podem mudar o resultado. Não substitui orientação jurídica.
> [Texto oficial da EC 141/2026](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm).

## Privacidade

Não há login, servidor nem coleta de dados. A configuração e a escala ficam no `localStorage` do navegador,
no aparelho de quem usa. Por isso, **baixe o backup de vez em quando**: o iPhone pode apagar dados de sites
depois de alguns dias sem uso.

---

## Rodando o projeto

Requisitos: **Node.js 18+** e npm.

```bash
npm install
```

```bash
npm run dev
```

O site abre em `http://localhost:5173`.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento (Vite) |
| `npm run build` | Checa os tipos e gera o site estático em `dist/` |
| `npm run preview` | Serve o build localmente |
| `npm test` | Roda os testes (Vitest) |
| `npm run test:watch` | Testes em modo observação |
| `npm run typecheck` | Só a checagem de tipos |
| `npm run lint` | ESLint |

O resultado do build é um site estático: dá para publicar em qualquer hospedagem de arquivos
(Netlify, Vercel, GitHub Pages, Cloudflare Pages etc.).

## Tecnologias

- **React 18** + **TypeScript**, com **Vite**
- **Zustand** para o estado e **Zod** para validar o backup
- **html-to-image** para gerar a imagem do WhatsApp
- **Vitest** + **Testing Library** nos testes
- CSS puro, com `<dialog>` nativo para painéis e confirmações

## Estrutura

```
src/
├── domain/        Motor da escala, sem React: gerador, regras legais, cobertura,
│                  sugestões, intervalos, visão do mês e datas
├── state/         Store (Zustand), esquema e backup
├── ui/
│   ├── setup/     Configuração em quatro passos
│   ├── schedule/  Tabela do ciclo, mês, dia, painéis de edição e alertas
│   └── export/    Impressão, imagem para WhatsApp e escala individual
├── test/          Setup e dados de exemplo dos testes
├── App.tsx
└── main.tsx
docs/plans/        Plano do produto: requisitos, decisões e fluxos
```

As regras ficam todas em `src/domain/`, separadas da interface e cobertas por testes. O plano completo do
produto, com cada requisito e decisão, está em [`docs/plans/`](docs/plans/2026-11-13-001-feat-escala-5x2-clt-plan.md).
