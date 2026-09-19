"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  criarTokenDePlataforma,
  revogarTokenDePlataforma,
} from "@/app/actions/plataforma/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

interface TokenNaLista {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly operacoes: string[];
  readonly reason: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly revoke_reason: string | null;
}

interface OperacaoNaTela {
  readonly chave: string;
  readonly rotulo: string;
  readonly raio: string;
}

export function TokensDePlataforma({
  tokens,
  operacoes,
}: {
  readonly tokens: readonly TokenNaLista[];
  readonly operacoes: readonly OperacaoNaTela[];
}) {
  const t = useT();
  const router = useRouter();
  const [salvando, iniciar] = useTransition();

  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dias, setDias] = useState("90");
  const [marcadas, setMarcadas] = useState<string[]>([]);

  /**
   * O plaintext recém-criado. Fica na TELA e em nenhum outro lugar — some no
   * próximo carregamento, porque o banco só tem o hash. Guardar em
   * `localStorage` para "não perder" seria deixar a credencial de administração
   * da instalação no disco de quem abriu a página.
   */
  const [recemCriado, setRecemCriado] = useState<string | null>(null);

  function alternar(chave: string) {
    setMarcadas((m) => (m.includes(chave) ? m.filter((c) => c !== chave) : [...m, chave]));
  }

  function criar() {
    const diasNum = dias.trim() === "" ? null : Number(dias);
    if (diasNum !== null && (!Number.isInteger(diasNum) || diasNum < 1)) {
      toast.error(t("A validade precisa ser um número de dias, ou ficar em branco."));
      return;
    }
    iniciar(async () => {
      const r = await criarTokenDePlataforma({
        name: nome,
        reason: motivo,
        operacoes: marcadas,
        expiresInDays: diasNum,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setRecemCriado(r.token);
      setNome("");
      setMotivo("");
      setMarcadas([]);
      router.refresh();
    });
  }

  function revogar(id: string, nomeDoToken: string) {
    const razao = window.prompt(t("Por que está revogando este token?"));
    if (razao === null) return;
    iniciar(async () => {
      const r = await revogarTokenDePlataforma({ id, motivo: razao });
      if (r.ok) {
        toast.success(`${t("Token revogado:")} ${nomeDoToken}`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {recemCriado ? (
        <Card className="space-y-2 border-amber-500/40 bg-amber-50/60 p-4 dark:bg-amber-900/10">
          <h2 className="text-sm font-semibold">{t("Copie agora — isto não aparece de novo")}</h2>
          <p className="text-xs text-text-muted">
            {t(
              "Só o resumo criptográfico fica gravado. Se perder, a saída é revogar este e emitir outro.",
            )}
          </p>
          <pre className="overflow-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-xs">
            {recemCriado}
          </pre>
          <Button variant="outline" size="sm" onClick={() => setRecemCriado(null)}>
            {t("Já copiei")}
          </Button>
        </Card>
      ) : null}

      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">{t("Emitir um token")}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tk-nome">{t("Nome")}</Label>
            <Input
              id="tk-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("ex: implantação de clientes")}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tk-dias">{t("Validade em dias")}</Label>
            <Input
              id="tk-dias"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              placeholder={t("em branco = não expira")}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tk-motivo">{t("Por que este token existe")}</Label>
          <Input
            id="tk-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t("quem vai usar, e para quê")}
            maxLength={200}
          />
          <p className="text-xs text-text-muted">
            {t("Quem for auditar daqui a seis meses lê esta frase, não o nome.")}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{t("O que este token pode ESCREVER")}</Label>
          <p className="text-xs text-text-muted">
            {t(
              "Nenhuma marcada = o token só lê, e ler é livre. Cada caixinha diz o que acontece se ele vazar.",
            )}
          </p>
          <div className="space-y-2">
            {operacoes.map((o) => (
              <label
                key={o.chave}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={marcadas.includes(o.chave)}
                  onChange={() => alternar(o.chave)}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{o.rotulo}</span>
                  <span className="block text-xs text-text-muted">{o.raio}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={criar} disabled={salvando}>
            {salvando ? t("Emitindo...") : t("Emitir token")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <h2 className="text-base font-semibold">{t("Tokens emitidos")}</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum token emitido ainda.")}</p>
        ) : (
          <ul className="space-y-3">
            {tokens.map((tk) => {
              const vivo = !tk.revoked_at;
              return (
                <li
                  key={tk.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{tk.name}</span>
                      <span className="font-mono text-xs text-text-muted">{tk.prefix}…</span>
                      {!vivo ? (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
                          {t("revogado")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-text-muted">{tk.reason}</p>
                    <p className="text-xs text-text-muted">
                      {tk.operacoes.length === 0
                        ? t("só leitura")
                        : `${t("escreve:")} ${tk.operacoes.join(", ")}`}
                    </p>
                    {tk.revoke_reason ? (
                      <p className="text-xs text-text-muted">
                        {t("Motivo da revogação:")} {tk.revoke_reason}
                      </p>
                    ) : null}
                  </div>
                  {vivo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={salvando}
                      onClick={() => revogar(tk.id, tk.name)}
                    >
                      {t("Revogar")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
