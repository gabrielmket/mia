"use client";
/**
 * FORK MIA (.85) — o editor do HORÁRIO DE ATENDIMENTO DA IA, que substitui na
 * tela o "Só atender em horário de funcionamento" do upstream.
 *
 * Dentro do horário a IA está ativa e responde; fora dele está inativa, não
 * responde a mensagem que chegou, nem depois, e a conversa fica com a equipe.
 * Cada dia: ativa nos horários, ativa o dia todo ou inativa o dia todo; até 6
 * faixas por dia, "24:00" como fim do dia, e a faixa que passa da meia-noite
 * vira duas pelo botão "Dividir". Erro em vermelho trava o salvar (o schema da
 * versão recusa a grade crua, ver `lib/ai/agents/grade-do-horario-da-ia.ts`).
 *
 * Grava `filters.horario_da_ia` e zera `filters.business_hours` (o horário
 * antigo, que ADIAVA a resposta). Vale ao publicar, como o resto do rascunho.
 *
 * Avisa quando o horário cai fora da janela de RESPOSTA do número (a proteção
 * contra bloqueio, padrão 7h às 22h) e oferece ao administrador abrir as
 * respostas 24h naquele número, pela rota da tela de Proteção de envio
 * (`PUT /api/v1/ai/pacing`, só `resposta_*`: disparo e prospecção não mudam).
 */
import * as React from "react";
import { toast } from "sonner";

import { quandoDaTroca, useRelogioDoSelo } from "@/components/ai/SeloDoHorarioDaIa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePacingKnobs, useUpdatePacingKnobs } from "@/hooks/channels/usePacingKnobs";
import { useT } from "@/hooks/i18n/useT";
import {
  analisarDia,
  ativaEm,
  horaDosMinutos,
  horarioForaDaJanelaDeResposta,
  MAX_FAIXAS_POR_DIA,
  MENSAGEM_SEM_FAIXA,
  MINUTOS_NA_SEMANA,
  MINUTOS_NO_DIA,
  proximaTroca,
  relogioNoFuso,
  type HorarioDaIaGravado,
} from "@/lib/agent-engine/agent/horario-da-ia";
import {
  acrescentarFaixa,
  copiarSegundaParaASemana,
  dividirNaMeiaNoite,
  editarFaixa,
  gradeDoGravado,
  gravadoDaGrade,
  horarioDaGrade,
  intervalosDoDia,
  minutosAtivosDaGrade,
  ORDEM_DA_SEMANA,
  semNenhumaFaixa,
  tirarFaixa,
  trocarTipoDoDia,
  type GradeNaTela,
  type TipoDoDia,
} from "@/lib/ai/agents/grade-do-horario-da-ia";
import { textoEstavel } from "@/lib/ai/agents/mesmo-rascunho";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";
import { cn } from "@/lib/utils";

import type { TriggerValue } from "./TriggerEditor";

interface Props {
  value: TriggerValue;
  onChange: (v: TriggerValue) => void;
  disabled?: boolean;
  /** `organizations.timezone`, o fuso de quem não escolhe outro. */
  organizationTimezone: string;
  /** O número por onde o agente atende (`""`/ausente = ainda não escolhido). */
  channelSessionId?: string | null;
  /** Só o administrador abre as respostas 24h do número. */
  podeAbrirJanela?: boolean;
}

/** "16h30" de 990 minutos. */
function duracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

export function HorarioDaIaEditor({
  value,
  onChange,
  disabled,
  organizationTimezone,
  channelSessionId,
  podeAbrirJanela,
}: Props) {
  const t = useT();
  const agora = useRelogioDoSelo();
  const gravado = (value.filters.horario_da_ia ?? null) as HorarioDaIaGravado | null;
  const [grade, setGrade] = React.useState<GradeNaTela>(() => gradeDoGravado(gravado, organizationTimezone));

  // O valor mudou POR FORA (descartar, recarregar depois de salvar): a grade
  // volta a ser a do dado. O que a própria grade emitiu não reabre nada (a
  // volta dela é igual ao valor). Ajuste durante o render, sem efeito: é o
  // padrão do React para estado que acompanha uma prop.
  const chaveDoGravado = textoEstavel(gravado);
  const [chaveVista, setChaveVista] = React.useState(chaveDoGravado);
  if (chaveVista !== chaveDoGravado) {
    setChaveVista(chaveDoGravado);
    if (textoEstavel(gravadoDaGrade(grade)) !== chaveDoGravado) setGrade(gradeDoGravado(gravado, organizationTimezone));
  }

  function emitir(nova: GradeNaTela) {
    setGrade(nova);
    onChange({
      ...value,
      // O horário da IA substitui o antigo: gravar um zera o outro.
      filters: { ...value.filters, business_hours: null, horario_da_ia: gravadoDaGrade(nova) },
    });
  }

  const nomeDoDia = (d: number): string =>
    [t("Domingo"), t("Segunda"), t("Terça"), t("Quarta"), t("Quinta"), t("Sexta"), t("Sábado")][d] ?? "";

  const horario = horarioDaGrade(grade);
  const ativos = minutosAtivosDaGrade(grade);
  const vazio = semNenhumaFaixa(grade);

  // ── a janela de resposta do número ────────────────────────────────────────
  const numero = channelSessionId ? channelSessionId : null;
  const knobs = usePacingKnobs(numero !== null);
  const abrir = useUpdatePacingKnobs();
  const doNumero = knobs.data?.items.find((i) => i.channel_session.id === numero) ?? null;
  const janela = doNumero
    ? {
        inicioHora: doNumero.effective.respostaStartHour,
        fimHora: doNumero.effective.respostaEndHour,
        domingo: doNumero.effective.allowSunday,
        fuso: doNumero.effective.timezone,
      }
    : null;
  const foraDaJanela = horario !== null && janela !== null && horarioForaDaJanelaDeResposta(horario, janela, agora);
  const nomeDoNumero = doNumero?.channel_session.display_name ?? doNumero?.channel_session.phone_number ?? "";

  function abrirRespostas24h() {
    if (numero === null) return;
    abrir.mutate(
      { channel_session_id: numero, resposta_start_hour: 0, resposta_end_hour: 24 },
      {
        onSuccess: () => toast.success(t("Respostas liberadas 24h neste número. Disparo e prospecção continuam como estavam.")),
        onError: () => toast.error(t("Não consegui abrir as respostas 24h. Tente de novo em Conexões › Proteção de envio.")),
      },
    );
  }

  // ── o estado de agora, com a grade da tela ────────────────────────────────
  let agoraNoFuso: { dia: number; minutos: number } | null = null;
  try {
    agoraNoFuso = relogioNoFuso(grade.fuso, agora);
  } catch {
    agoraNoFuso = null;
  }
  let situacao: string | null = null;
  if (horario !== null) {
    const ativa = ativaEm(horario, agora);
    const troca = proximaTroca(horario, agora);
    situacao = ativa
      ? troca
        ? `${t("Com este horário, a IA está ativa agora e fica inativa")} ${troca.diasAdiante === 0 ? `${t("às")} ${troca.hora}` : quandoDaTroca(troca, t)}.`
        : t("Com este horário, a IA fica ativa a semana inteira.")
      : troca
        ? `${t("Com este horário, a IA está inativa agora e volta")} ${troca.diasAdiante === 0 ? `${t("às")} ${troca.hora}` : quandoDaTroca(troca, t)}.`
        : null;
  }

  const fusos = FUSOS_OFERECIDOS.some((f) => f.codigo === grade.fuso)
    ? FUSOS_OFERECIDOS
    : [{ codigo: grade.fuso, rotulo: grade.fuso }, ...FUSOS_OFERECIDOS];
  const horarioAntigo = value.filters.business_hours;

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3" data-testid="horario-da-ia">
      <div className="space-y-1">
        <Label>{t("Horário de atendimento da IA")}</Label>
        <p className="text-xs text-muted-foreground">
          {t(
            "Dentro do horário a IA responde. Fora dele ela fica inativa: não responde o que chegar, nem depois, e a conversa fica com a equipe. Vale depois de publicar.",
          )}
        </p>
      </div>

      {horarioAntigo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/35 bg-warning-bg p-2 text-xs text-warning-fg">
          <span className="min-w-0 flex-1">
            {`${t("Este agente ainda tem o horário antigo, que adia a resposta para a abertura:")} ${horarioAntigo.start} ${t("às")} ${horarioAntigo.end}. ${t("Ele deixa de valer quando você monta o horário da IA.")}`}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange({ ...value, filters: { ...value.filters, business_hours: null } })}
          >
            {t("Tirar o horário antigo")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Quando a IA fica ativa")}>
        <Button
          type="button"
          size="sm"
          variant={grade.modo === "sempre" ? "primary" : "outline"}
          aria-pressed={grade.modo === "sempre"}
          disabled={disabled}
          onClick={() => emitir({ ...grade, modo: "sempre" })}
        >
          {t("Ativa a qualquer hora")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={grade.modo === "horario" ? "primary" : "outline"}
          aria-pressed={grade.modo === "horario"}
          disabled={disabled}
          onClick={() => emitir({ ...grade, modo: "horario" })}
        >
          {t("Ativa só no horário abaixo")}
        </Button>
      </div>

      {grade.modo === "sempre" ? (
        <p className="text-xs text-muted-foreground">
          {t('A IA responde a qualquer hora. Escolha "Ativa só no horário abaixo" para montar a grade da semana.')}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="horario_da_ia_fuso">{t("Fuso horário")}</Label>
              <Select
                value={grade.fuso}
                onValueChange={(fuso) => emitir({ ...grade, fuso })}
                disabled={disabled}
              >
                <SelectTrigger id="horario_da_ia_fuso" className="w-72 max-w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fusos.map((f) => (
                    <SelectItem key={f.codigo} value={f.codigo}>
                      {f.codigo === organizationTimezone ? `${t(f.rotulo)} · ${t("o da empresa")}` : t(f.rotulo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            {ORDEM_DA_SEMANA.map((d) => {
              const dia = grade.dias[d]!;
              const analise = analisarDia(dia.faixas);
              const comErro = new Set(analise.problemas.map((p) => p.faixa));
              const ativoNoDia = intervalosDoDia(dia).reduce((s, [a, b]) => s + (b - a), 0);
              const resumo =
                ativoNoDia === 0
                  ? t("inativa o dia todo")
                  : ativoNoDia === MINUTOS_NO_DIA
                    ? t("ativa o dia todo")
                    : `${duracao(ativoNoDia)} ${t("ativa")}`;
              return (
                <div key={d} className="grid grid-cols-1 gap-2 border-t border-border/40 pt-2 md:grid-cols-[8rem_1fr]" data-dia={d}>
                  <div className="flex items-baseline gap-2 md:block">
                    <p className="text-sm font-medium">{nomeDoDia(d)}</p>
                    <p className="text-xs text-muted-foreground">{resumo}</p>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                      {intervalosDoDia(dia).map(([a, b]) => (
                        <span
                          key={`${a}-${b}`}
                          className="absolute inset-y-0 bg-primary"
                          style={{ left: `${(a / MINUTOS_NO_DIA) * 100}%`, width: `${((b - a) / MINUTOS_NO_DIA) * 100}%` }}
                        />
                      ))}
                      {agoraNoFuso && agoraNoFuso.dia === d ? (
                        <span
                          className="absolute inset-y-0 w-0.5 bg-foreground"
                          style={{ left: `${(agoraNoFuso.minutos / MINUTOS_NO_DIA) * 100}%` }}
                          title={t("Agora")}
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={dia.tipo}
                        onValueChange={(tipo) => emitir(trocarTipoDoDia(grade, d, tipo as TipoDoDia))}
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-52 max-w-full" aria-label={`${nomeDoDia(d)}: ${t("como fica")}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="faixas">{t("Ativa nos horários")}</SelectItem>
                          <SelectItem value="dia_todo">{t("Ativa o dia todo")}</SelectItem>
                          <SelectItem value="inativa">{t("Inativa o dia todo")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {dia.tipo === "faixas"
                        ? dia.faixas.map((f, i) => (
                            <span
                              key={i}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-1",
                                comErro.has(i) ? "border-destructive" : "border-border/60",
                              )}
                            >
                              <Input
                                value={f.inicio}
                                onChange={(e) => emitir(editarFaixa(grade, d, i, "inicio", e.target.value))}
                                inputMode="numeric"
                                maxLength={5}
                                autoComplete="off"
                                className="w-[4.5rem] text-center"
                                aria-label={`${nomeDoDia(d)}, ${t("faixa")} ${i + 1}, ${t("começa")}`}
                                aria-invalid={comErro.has(i)}
                                disabled={disabled}
                              />
                              <span className="text-xs text-muted-foreground">{t("até")}</span>
                              <Input
                                value={f.fim}
                                onChange={(e) => emitir(editarFaixa(grade, d, i, "fim", e.target.value))}
                                inputMode="numeric"
                                maxLength={5}
                                autoComplete="off"
                                className="w-[4.5rem] text-center"
                                aria-label={`${nomeDoDia(d)}, ${t("faixa")} ${i + 1}, ${t("termina")}`}
                                aria-invalid={comErro.has(i)}
                                disabled={disabled}
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => emitir(tirarFaixa(grade, d, i))}
                                disabled={disabled}
                                aria-label={`${t("Tirar a faixa")} ${i + 1} ${t("de")} ${nomeDoDia(d)}`}
                                title={t("Tirar a faixa")}
                              >
                                ×
                              </Button>
                            </span>
                          ))
                        : null}
                      {dia.tipo === "faixas" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled || dia.faixas.length >= MAX_FAIXAS_POR_DIA}
                          title={dia.faixas.length >= MAX_FAIXAS_POR_DIA ? t("Até 6 faixas por dia.") : undefined}
                          onClick={() => {
                            const nova = acrescentarFaixa(grade, d);
                            if (nova) emitir(nova);
                          }}
                        >
                          {t("+ faixa")}
                        </Button>
                      ) : null}
                    </div>
                    {dia.tipo === "faixas" ? (
                      <div className="space-y-1">
                        {analise.problemas.map((p) =>
                          p.tipo === "vira_a_meia_noite" ? (
                            <div key={`p-${p.faixa}`} className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                              <span>
                                {`${t("A faixa")} ${horaDosMinutos(p.inicio)} ${t("até")} ${horaDosMinutos(p.fim)} ${t("passa da meia-noite.")}`}
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => emitir(dividirNaMeiaNoite(grade, d, p.faixa))}
                              >
                                {`${t("Dividir:")} ${horaDosMinutos(p.inicio)} ${t("às")} 24:00 ${t("e")} ${nomeDoDia((d + 1) % 7)} 00:00 ${t("às")} ${horaDosMinutos(p.fim)}`}
                              </Button>
                            </div>
                          ) : p.tipo === "igual" ? (
                            <p key={`p-${p.faixa}`} className="text-xs text-destructive">
                              {`${t("A faixa")} ${p.faixa + 1} ${t("começa e termina no mesmo horário.")}`}
                            </p>
                          ) : (
                            <p key={`p-${p.faixa}`} className="text-xs text-destructive">
                              {`${t("Faixa")} ${p.faixa + 1}: ${t("escreva como 08:30. Para o fim do dia, use 24:00.")}`}
                            </p>
                          ),
                        )}
                        {dia.faixas.length > MAX_FAIXAS_POR_DIA ? (
                          <p className="text-xs text-destructive">{t("Até 6 faixas por dia.")}</p>
                        ) : null}
                        {analise.uniu ? (
                          <p className="text-xs text-muted-foreground">{t("Faixas que se cruzam contam como uma só.")}</p>
                        ) : null}
                        {dia.faixas.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t("Sem faixa: inativa o dia todo.")}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {`${t("Ativa")} ${duracao(ativos)} ${t("por semana")} · ${t("inativa")} ${duracao(MINUTOS_NA_SEMANA - ativos)}`}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                emitir(copiarSegundaParaASemana(grade));
                toast.success(t("Segunda copiada para terça, quarta, quinta e sexta."));
              }}
            >
              {t("Copiar a segunda para terça a sexta")}
            </Button>
          </div>

          {vazio ? <p className="text-xs text-destructive">{t(MENSAGEM_SEM_FAIXA)}</p> : null}
          {situacao ? <p className="text-xs text-muted-foreground">{situacao}</p> : null}
        </div>
      )}

      {foraDaJanela && janela ? (
        <div className="space-y-2 rounded-md border border-warning/35 bg-warning-bg p-2 text-xs text-warning-fg" data-testid="horario-fora-da-janela">
          <p>
            {`${t("O número")} ${nomeDoNumero} ${t("só envia respostas das")} ${janela.inicioHora}h ${t("às")} ${janela.fimHora}h${janela.domingo ? "" : ` ${t("e não envia no domingo")}`}, ${t("para se proteger de bloqueio. Com este horário a IA fica ativa fora dessa janela, e o que ela escrever nesse período só sai quando a janela abre.")}`}
          </p>
          {podeAbrirJanela ? (
            <Button type="button" size="sm" variant="outline" disabled={abrir.isPending} onClick={abrirRespostas24h}>
              {t("Abrir as respostas 24h neste número")}
            </Button>
          ) : (
            <p>{t("Um administrador pode abrir as respostas 24h neste número.")}</p>
          )}
          <p className="opacity-80">
            {t("Abrir vale só para a resposta a quem escreveu. Disparo em massa, retomada e prospecção continuam na janela de disparo do número.")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
