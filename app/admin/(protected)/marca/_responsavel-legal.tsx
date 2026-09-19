"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateResponsavelLegal } from "@/app/actions/settings/updateResponsavelLegal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { responsavelLegalSchema } from "@/lib/schemas/settings";
import { useT } from "@/hooks/i18n/useT";

export interface ResponsavelLegalGravado {
  readonly operador_razao_social: string | null;
  readonly operador_cnpj: string | null;
  readonly operador_dpo_email: string | null;
  readonly operador_politica_url: string | null;
}

/** Texto vazio é ausência, não string vazia — apagar é uma escolha legítima. */
function ouNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * Quem responde legalmente por esta instalação (item E7, migration 0267).
 *
 * ── Por que é um formulário SEPARADO, na mesma tela ───────────────────────
 *
 * As colunas moram na mesma tabela da marca, e mesmo assim o salvamento é
 * outro. Trocar a cor do produto é reversível e não obriga ninguém; declarar
 * quem responde pelos dados muda o que um documento jurídico público afirma
 * sobre uma empresa real. Um botão só significaria publicar uma razão social
 * sem querer ao ajustar um logo.
 *
 * ── O que o campo de cima decide ──────────────────────────────────────────
 *
 * A razão social é o INTERRUPTOR entre os dois modos da instalação, e por isso
 * o bloco explica os dois em vez de só rotular o campo: quem chega aqui precisa
 * saber que preencher muda o documento para TODO leitor, e que apagar devolve o
 * comportamento anterior. Sem isso o campo parece um dado de cadastro.
 */
export function ResponsavelLegal({ gravado }: { readonly gravado: ResponsavelLegalGravado }) {
  const t = useT();
  const router = useRouter();
  const [salvando, iniciarSalvamento] = useTransition();

  const [razaoSocial, setRazaoSocial] = useState(gravado.operador_razao_social ?? "");
  const [cnpj, setCnpj] = useState(gravado.operador_cnpj ?? "");
  const [dpoEmail, setDpoEmail] = useState(gravado.operador_dpo_email ?? "");
  const [politica, setPolitica] = useState(gravado.operador_politica_url ?? "");

  const gerenciado = razaoSocial.trim() !== "";

  function salvar() {
    const entrada = {
      operador_razao_social: ouNulo(razaoSocial),
      operador_cnpj: ouNulo(cnpj),
      operador_dpo_email: ouNulo(dpoEmail),
      operador_politica_url: ouNulo(politica),
    };

    // Valida ANTES de chamar: a action revalida (ela é a fronteira de verdade),
    // mas um e-mail digitado errado merece a mensagem do campo, não um
    // `validation_failed` genérico vindo do servidor.
    const conferido = responsavelLegalSchema.safeParse(entrada);
    if (!conferido.success) {
      const campos = conferido.error.flatten().fieldErrors;
      if (campos.operador_dpo_email) {
        toast.error(t("O e-mail do encarregado não parece um e-mail."));
      } else if (campos.operador_politica_url) {
        toast.error(t("O endereço da política precisa começar com https://"));
      } else {
        toast.error(t("Confira os campos do responsável legal."));
      }
      return;
    }

    iniciarSalvamento(async () => {
      const r = await updateResponsavelLegal(conferido.data);
      if (r.ok) {
        toast.success(t("Responsável legal salvo."));
        router.refresh();
      } else {
        toast.error(t("Não deu para salvar o responsável legal."));
      }
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("Responsável legal desta instalação")}</h2>
        <p className="text-xs text-text-muted">
          {t(
            "As páginas de Política de Privacidade e Termos de Uso precisam dizer QUEM responde pelos dados tratados aqui. Preenchendo a razão social abaixo, elas passam a nomear esta empresa para qualquer pessoa que as abrir. Deixando em branco, elas nomeiam a empresa que estiver selecionada na sessão de quem está lendo — o que só faz sentido quando a instalação inteira é de uma empresa só.",
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operador_razao_social">{t("Razão social")}</Label>
        <Input
          id="operador_razao_social"
          value={razaoSocial}
          onChange={(e) => setRazaoSocial(e.target.value)}
          placeholder={t("Nome da empresa no CNPJ")}
          maxLength={200}
          autoComplete="off"
        />
        <p className="text-xs text-text-muted">
          {gerenciado
            ? t(
                "Em vigor: os documentos legais nomeiam esta empresa, para todo mundo que os abrir.",
              )
            : t(
                "Em branco: os documentos legais nomeiam a empresa selecionada na sessão de quem lê.",
              )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="operador_cnpj">{t("CNPJ")}</Label>
          <Input
            id="operador_cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0001-00"
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="operador_dpo_email">{t("E-mail do encarregado de dados")}</Label>
          <Input
            id="operador_dpo_email"
            type="email"
            value={dpoEmail}
            onChange={(e) => setDpoEmail(e.target.value)}
            placeholder="privacidade@exemplo.com.br"
            maxLength={320}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operador_politica_url">{t("Endereço da política própria")}</Label>
        <Input
          id="operador_politica_url"
          value={politica}
          onChange={(e) => setPolitica(e.target.value)}
          placeholder="https://exemplo.com.br/privacidade"
          maxLength={2048}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-text-muted">
          {t(
            "Se a empresa já publica a política dela em outro endereço, ponha aqui: a página do sistema passa a levar para lá em vez de mostrar o texto padrão.",
          )}
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? t("Salvando...") : t("Salvar responsável legal")}
        </Button>
      </div>
    </Card>
  );
}
