/**
 * FORK MIA (.88) — "POR ONDE EU COMEÇO?": a ordem do dia, DETERMINÍSTICA.
 *
 * A régua do protótipo, nesta ordem: algo parado na empresa (número caído),
 * cliente esperando, compromisso do dia, atraso e meta. Os leads em risco
 * entram depois do atraso: é o que esfria se ninguém mexer hoje.
 *
 * É função pura sobre o que as leituras devolveram, e por isso serve aos dois:
 * o turno (o assistente apresenta a lista) e o resumo da manhã das 8h, que não
 * gasta IA nenhuma (regra "Resumo da manhã"). Os textos saem por `t()`, com os
 * números substituídos depois, para o resumo sair no idioma de quem lê.
 */
import { formatarDinheiro } from "./dinheiro";
import type { LeadsDaPessoa } from "./leituras/leads";
import type { PerformanceLida } from "./leituras/performance";
import type { RotinaDoDia } from "./leituras/rotina";

export interface Prioridade {
  ordem: number;
  /** O que fazer, já com os números. */
  texto: string;
  /** "Me leva lá". */
  href: string;
  rotulo: string;
}

type Traduzir = (texto: string) => string;

function preencher(modelo: string, valores: Record<string, string | number>): string {
  return modelo.replace(/\{(\w+)\}/g, (_, chave: string) => String(valores[chave] ?? ""));
}

export function prioridadesDoDia(
  entrada: {
    rotina: RotinaDoDia;
    leads: LeadsDaPessoa | null;
    performance: PerformanceLida | null;
    idioma: string;
  },
  t: Traduzir = (x) => x,
): Prioridade[] {
  const { rotina, leads, performance } = entrada;
  const lista: Omit<Prioridade, "ordem">[] = [];
  const equipe = rotina.escopo === "equipe";

  for (const n of rotina.numeros_desconectados ?? []) {
    lista.push({
      texto: preencher(t('Religar o número "{nome}": enquanto ele estiver desconectado, nada que chega por ele é visto.'), {
        nome: n.nome,
      }),
      href: "/app/connections",
      rotulo: t("Ver conexões"),
    });
  }

  const esperando = rotina.conversas.mais_antigas[0];
  if (esperando) {
    lista.push({
      texto: equipe
        ? preencher(t("{n} conversas esperam resposta; a mais antiga, de {contato}, há {horas} h."), {
            n: rotina.conversas.esperando_resposta,
            contato: esperando.contato,
            horas: esperando.horas,
          })
        : preencher(t("Responder {contato}: espera há {horas} h."), { contato: esperando.contato, horas: esperando.horas }),
      href: `/app/inbox?id=${esperando.conversation_id}`,
      rotulo: t("Abrir conversa"),
    });
  }
  if (equipe && (rotina.conversas.sem_dono ?? 0) > 0) {
    lista.push({
      texto: preencher(t("Dar dono às {n} conversas abertas sem ninguém responsável."), { n: rotina.conversas.sem_dono ?? 0 }),
      href: "/app/inbox",
      rotulo: t("Abrir conversas"),
    });
  }

  const proximo = rotina.agenda.itens[0];
  if (proximo) {
    lista.push({
      texto: preencher(t("{n} compromissos hoje; o primeiro: {titulo}, {quando}."), {
        n: rotina.agenda.compromissos,
        titulo: proximo.titulo,
        quando: proximo.quando,
      }),
      href: "/app/agenda",
      rotulo: t("Ver a agenda"),
    });
  }

  if (rotina.tarefas.atrasadas > 0) {
    const quem = rotina.tarefas.atrasadas_por_pessoa?.[0];
    lista.push({
      texto:
        equipe && quem
          ? preencher(t("{n} tarefas atrasadas na equipe; {nome} tem {m} delas."), {
              n: rotina.tarefas.atrasadas,
              nome: quem.nome,
              m: quem.atrasadas,
            })
          : preencher(t("{n} tarefas atrasadas para destravar."), { n: rotina.tarefas.atrasadas }),
      href: "/app/tasks",
      rotulo: t("Abrir tarefas"),
    });
  }

  if (leads && leads.em_risco > 0) {
    lista.push({
      texto: preencher(t("{n} negócios em risco: sem movimento além da janela da etapa."), { n: leads.em_risco }),
      href: "/app/radar",
      rotulo: t("Ver no Radar"),
    });
  }

  if (performance?.meta && performance.meta.falta_cents > 0) {
    lista.push({
      texto: preencher(t("Meta do mês: faltam {falta} ({pct}% feito)."), {
        falta: formatarDinheiro(performance.meta.falta_cents, performance.moeda, entrada.idioma),
        pct: Math.round(performance.meta.fracao * 100),
      }),
      href: "/app/metrics",
      rotulo: t("Ver desempenho"),
    });
  }

  return lista.slice(0, 6).map((p, i) => ({ ...p, ordem: i + 1 }));
}

/** O texto do resumo da manhã: a saudação, os números do dia e a ordem. Sem IA. */
export function textoDoResumoDaManha(
  entrada: { primeiroNome: string; rotina: RotinaDoDia; prioridades: Prioridade[] },
  t: Traduzir = (x) => x,
): string {
  const { rotina } = entrada;
  const linhas: string[] = [];
  linhas.push(preencher(t("Bom dia, {nome}. Seu plano para hoje:"), { nome: entrada.primeiroNome }));
  linhas.push(
    preencher(t("{agenda} compromissos · {tarefas} tarefas de hoje · {atrasadas} atrasadas · {conversas} conversas esperando resposta"), {
      agenda: rotina.agenda.compromissos,
      tarefas: rotina.tarefas.de_hoje,
      atrasadas: rotina.tarefas.atrasadas,
      conversas: rotina.conversas.esperando_resposta,
    }),
  );
  if (entrada.prioridades.length === 0) {
    linhas.push(t("Nada pendente por enquanto. Bom trabalho."));
  } else {
    for (const p of entrada.prioridades) linhas.push(`${p.ordem}. ${p.texto}`);
  }
  linhas.push(t("Eu ordeno por: algo parado na empresa, cliente esperando, compromisso do dia, atraso e meta."));
  return linhas.join("\n");
}
