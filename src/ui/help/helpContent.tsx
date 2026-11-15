import type { ReactNode } from 'react';
import { LEGAL_SOURCE_URL } from '../../domain/legal';

export const INSTAGRAM_HANDLE = 'erick.osnt';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

export interface TutorialStep {
  title: string;
  body: ReactNode;
}

/** Passo a passo da aba "Como usar", na ordem em que a pessoa usa o site. */
export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Comece por um exemplo ou do zero',
    body: (
      <>
        Na tela inicial dá para abrir um exemplo pronto (mercado, loja de roupas, padaria, farmácia ou restaurante) e
        mexer à vontade. Se preferir, toque em <b>Começar do zero</b> e monte a sua do zero.
      </>
    ),
  },
  {
    title: 'Loja: dias e horários',
    body: (
      <>
        Marque os dias em que abre e o horário de cada um. Escolha o regime (42h ou 40h) e se as folgas devem ficar
        juntas ou podem ser separadas. <b>Turno único</b> põe todo mundo no horário da loja naquele dia;{' '}
        <b>Sem folga</b> evita folgas num dia de muito movimento.
      </>
    ),
  },
  {
    title: 'Turnos',
    body: <>De 1 a 3 turnos. O site já sugere os horários a partir do funcionamento da loja; é só ajustar.</>,
  },
  {
    title: 'Funções e mínimo de pessoas',
    body: (
      <>
        Cadastre as funções (caixa, balconista, cozinha...) e quantas pessoas precisam estar em cada turno. O mínimo
        pode mudar conforme o dia da semana.
      </>
    ),
  },
  {
    title: 'Equipe',
    body: (
      <>
        Nome, função e turno de cada pessoa. Se alguém entra num horário diferente, marque <b>Horário próprio</b>. Marque{' '}
        <b>Funcionária mulher</b> quando for o caso: muda a regra de domingo (veja nas perguntas). Essa marcação nunca
        aparece no que você exporta.
      </>
    ),
  },
  {
    title: 'Gere e leia o resumo',
    body: (
      <>
        O site monta um ciclo de 3 semanas. No topo aparece <b>Tudo coberto</b> ou onde falta gente. Laranja é{' '}
        <b>buraco</b> (menos pessoas que o mínimo); vermelho é <b>alerta da CLT</b> (alguma regra sendo quebrada).
      </>
    ),
  },
  {
    title: 'Ajuste na própria tabela',
    body: (
      <>
        Toque num dia de uma pessoa para trocar folga, turno ou horário; tudo recalcula na hora e tem{' '}
        <b>Desfazer</b>. Toque num buraco para marcar quem cobre (você, a família ou alguém da equipe). Toque no nome do
        dia, lá em cima, para ver a linha do tempo com os intervalos.
      </>
    ),
  },
  {
    title: 'Ciclo e Mês',
    body: (
      <>
        <b>Ciclo</b> mostra as 3 semanas que se repetem. <b>Mês</b> mostra as datas de verdade, com feriados, e deixa
        mudar só uma data sem mexer no ciclo.
      </>
    ),
  },
  {
    title: 'Exporte e guarde um backup',
    body: (
      <>
        Em <b>Exportar</b> você imprime, gera a imagem para mandar no WhatsApp ou a escala individual de cada pessoa. Baixe
        o <b>backup</b> de vez em quando: é ele que salva seu trabalho se o navegador apagar os dados.
      </>
    ),
  },
];

export interface FaqItem {
  q: string;
  a: ReactNode;
}

export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

export const FAQ: FaqGroup[] = [
  {
    title: 'A escala e a lei',
    items: [
      {
        q: 'O que mudou com a EC 141/2026?',
        a: (
          <>
            A emenda acaba com a escala 6x1. Todo mundo passa a ter <b>2 dias de descanso por semana</b>, com teto de{' '}
            <b>42h semanais a partir de 16/12/2026</b> e de <b>40h a partir de 16/12/2027</b>.{' '}
            <a href={LEGAL_SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Ver o texto oficial
            </a>
            .
          </>
        ),
      },
      {
        q: 'O que é a escala 5x2?',
        a: (
          <>
            Cada pessoa trabalha 5 dias e folga 2 em toda semana (aqui a semana vai de domingo a sábado). As folgas não
            precisam ser sábado e domingo: podem cair em qualquer dia, juntas ou separadas, conforme a preferência que você
            escolhe na configuração.
          </>
        ),
      },
      {
        q: 'Por que a escala é feita de 3 em 3 semanas?',
        a: (
          <>
            <p>
              Por causa do <b>rodízio de domingo</b>. No comércio, a lei exige que cada pessoa folgue pelo menos{' '}
              <b>um domingo a cada 3 semanas</b> (Lei 10.101/2000, art. 6º).
            </p>
            <p>
              Com um ciclo de 3 semanas, cada pessoa folga exatamente 1 domingo por ciclo, e a equipe se divide em três
              grupos: em cada domingo, mais ou menos um terço folga e dois terços trabalham. É o jeito de cumprir a lei
              com o máximo de gente no domingo.
            </p>
            <p>
              Um ciclo de 4 semanas obrigaria cada pessoa a folgar 2 domingos (senão passaria de 3 semanas sem folga), e
              sobraria menos gente para o domingo. Depois da semana 3, a escala volta para a semana 1 e se repete igual.
            </p>
          </>
        ),
      },
      {
        q: 'Por que as funcionárias folgam mais domingos?',
        a: (
          <>
            A CLT (art. 386) garante às mulheres folga de domingo pelo menos <b>a cada 2 semanas</b>. No ciclo de 3
            semanas, isso vira 2 dos 3 domingos de folga. Por isso existe a marcação &ldquo;Funcionária mulher&rdquo; no
            cadastro da equipe.
          </>
        ),
      },
      {
        q: 'Escolho 42h ou 40h?',
        a: (
          <>
            O teto de 42h vale na transição, até 15/12/2027. A partir de 16/12/2027 o teto é 40h. Se quiser se adiantar,
            40h já cumpre a lei desde agora.
          </>
        ),
      },
      {
        q: 'Quantas horas alguém pode trabalhar por dia?',
        a: (
          <>
            No regime de 42h, até <b>8h24</b> por dia (as 42h divididas em 5 dias). No de 40h, até <b>8h</b>. Acima disso,
            só com acordo ou convenção coletiva, e o site avisa.
          </>
        ),
      },
      {
        q: 'Qual o intervalo de almoço obrigatório?',
        a: (
          <>
            Quem trabalha mais de 6h por dia precisa de <b>1h a 2h</b> de intervalo. Entre 4h e 6h, <b>15 minutos</b>. O
            intervalo não conta como hora trabalhada (CLT art. 71).
          </>
        ),
      },
      {
        q: 'Que outros descansos o site confere?',
        a: (
          <>
            <b>11h entre um dia de trabalho e o outro</b> (ex.: quem sai às 22h só pode voltar às 9h) e{' '}
            <b>35h seguidas de descanso na semana</b> (24h do descanso semanal mais as 11h). Nunca mais de 6 dias seguidos
            de trabalho nem mais de 2 folgas seguidas.
          </>
        ),
      },
      {
        q: 'E a convenção coletiva da minha categoria?',
        a: (
          <>
            O site aplica as regras gerais da EC 141/2026 e da CLT. A convenção coletiva pode mudar alguma coisa (horário,
            domingo, feriado), então vale conferir com o sindicato ou o contador. O site orienta, mas não substitui
            orientação jurídica.
          </>
        ),
      },
    ],
  },
  {
    title: 'Usando o site',
    items: [
      {
        q: 'Dá para montar a escala com o ChatGPT, o Claude ou outra IA?',
        a: (
          <>
            <p>
              Dá. Abra <b>Gerar com IA</b> (na tela inicial ou aqui embaixo) e toque em <b>Copiar texto para a IA</b>.
              Cole esse texto no ChatGPT, no Claude, no Gemini ou na IA que preferir. Ela vai te fazer as perguntas
              (horários, turnos, funções e equipe), mostrar um rascunho da escala e, no fim, entregar um código.
            </p>
            <p>
              Copie o código, volte em <b>Gerar com IA</b> e cole no campo de importação. O site gera a escala oficial,
              confere todas as regras e você ajusta o que quiser. Se aparecer algum erro, toque em{' '}
              <b>Copiar erros para a IA</b> e mande para ela: a IA corrige o código.
            </p>
          </>
        ),
      },
      {
        q: 'O que é um “buraco”?',
        a: (
          <>
            É quando um turno fica com menos pessoas do que o mínimo daquela função. Ele aparece em laranja, com sugestões
            para resolver: contratar, mudar alguém de turno ou reduzir o mínimo. Se você ou alguém da família vai cobrir,
            toque no buraco e marque <b>coberto por mim/família</b>. Se for alguém da equipe, as horas entram na conta da
            pessoa.
          </>
        ),
      },
      {
        q: 'Os alertas vermelhos me impedem de salvar?',
        a: (
          <>
            Não. Nada é bloqueado: o alerta só mostra qual regra está sendo quebrada e fica visível até você resolver. Você
            decide o que fazer.
          </>
        ),
      },
      {
        q: 'O que acontece se eu tocar em “Regerar”?',
        a: (
          <>
            O site monta a escala de novo do zero. Somem as trocas de folga, os horários ajustados num dia só, os ajustes de
            datas do mês e as marcações de cobertura. Ficam os horários do cadastro, o início do ciclo e os feriados. Antes,
            ele pede confirmação.
          </>
        ),
      },
      {
        q: 'Onde ficam meus dados?',
        a: (
          <>
            Só no seu aparelho, dentro do navegador. Não tem login, servidor nem coleta de dados. O lado ruim: se o
            navegador apagar os dados (o iPhone faz isso depois de alguns dias sem abrir o site), a escala some. Por isso,{' '}
            <b>baixe o backup</b> de vez em quando em <b>Exportar</b>.
          </>
        ),
      },
      {
        q: 'Como uso em outro celular ou computador?',
        a: (
          <>
            Baixe o backup no aparelho de origem, mande o arquivo para o outro (WhatsApp, e-mail...) e use{' '}
            <b>Restaurar backup</b> lá.
          </>
        ),
      },
      {
        q: 'Como mando a escala para a equipe?',
        a: (
          <>
            Em <b>Exportar</b>: imagem da semana para o WhatsApp, folha para imprimir (A4 deitada, funciona em preto e
            branco) ou a escala individual de cada pessoa, em calendário.
          </>
        ),
      },
      {
        q: 'É grátis?',
        a: <>Sim. Sem cadastro, sem anúncio e sem pegadinha.</>,
      },
    ],
  },
];
