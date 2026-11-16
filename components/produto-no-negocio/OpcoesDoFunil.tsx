"use client";
/**
 * FORK MIA (.109) · as opções do produto no negócio na edição do funil (tela 4
 * do protótipo, docs/fork/produto-no-negocio.md): o campo "Produto ou serviço"
 * do vocabulário, a explicação dele e o quadro "O que o negócio vendeu" com as
 * duas opções. O estado mora no editor do funil (upstream), que grava tudo no
 * mesmo patch de sempre (`updatePipelineConfig`).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { usePalavraDoProduto } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";
import { TAMANHO_MAXIMO_DA_PALAVRA } from "@/lib/produto-no-negocio/funil";

/** O 5º campo do vocabulário: como o funil chama o que o negócio vende. */
export function CampoDaPalavraDoProduto({ valor, onValor }: { valor: string; onValor: (v: string) => void }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor="vocabulario-produto">
        {t("Produto ou serviço")}
      </Label>
      <Input
        id="vocabulario-produto"
        value={valor}
        maxLength={TAMANHO_MAXIMO_DA_PALAVRA}
        placeholder={t("Produto ou serviço (padrão)")}
        onChange={(e) => onValor(e.target.value)}
      />
    </div>
  );
}

export function AjudaDaPalavraDoProduto() {
  const t = useT();
  return (
    <p className="text-xs text-muted-foreground">
      <b>{t("Produto ou serviço")}</b>:{" "}
      {t(
        'como este funil chama o que o negócio vende. Em branco, vale o padrão do sistema, "Produto ou serviço". Na implantação, o modelo do segmento já preenche: clínica, Tratamento; loja, Produto; escritório, Serviço. É a palavra do bloco do negócio, da janela de ganho e do relatório.',
      )}
    </p>
  );
}

/** O quadro "O que o negócio vendeu", com as duas opções do funil. */
export function OpcoesDoProdutoNoFunil({
  palavra,
  pedir,
  onPedir,
  mostrarRecorrente,
  onMostrarRecorrente,
}: {
  /** A palavra como está no campo agora (o quadro acompanha a digitação). */
  palavra: string;
  pedir: boolean;
  onPedir: (v: boolean) => void;
  mostrarRecorrente: boolean;
  onMostrarRecorrente: (v: boolean) => void;
}) {
  const t = useT();
  const formas = usePalavraDoProduto(palavra.trim() || null);
  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="opcoes-do-produto-no-funil">
      <h4 className="text-sm font-semibold">{t("O que o negócio vendeu")}</h4>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={pedir} onChange={(e) => onPedir(e.target.checked)} />
        <span>
          {t("Pedir o {produto} ao marcar como ganho").replace("{produto}", formas.s)}
          <span className="block text-xs text-muted-foreground">
            {t(
              "Ligado, a janela Marcar como ganho só confirma com pelo menos um {produto}. Vale para o botão e para o arrasto até a etapa de ganho. Desligado, a janela mostra os {produtos} mas deixa fechar sem.",
            )
              .replaceAll("{produtos}", formas.p)
              .replaceAll("{produto}", formas.s)}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={mostrarRecorrente}
          onChange={(e) => onMostrarRecorrente(e.target.checked)}
        />
        <span>
          {t("Mostrar valor recorrente")}
          <span className="block text-xs text-muted-foreground">
            {t(
              "Desligado, Valor recorrente (mensal), Duração (meses) e Tipo de receita somem de Editar negócio, de Novo negócio e do cartão deste funil, e o funil conta como avulso nas metas. O que já foi gravado neles continua guardado, e o negócio que tem valor ali mostra um aviso para corrigir.",
            )}
          </span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          "Nos funis que já existem as duas nascem como hoje: pedir desligado e valor recorrente ligado. Nada muda até alguém mexer.",
        )}
      </p>
    </div>
  );
}

/** A frase a mais da comanda do ganho: com itens, uma linha por item. */
export function FraseDaComandaPorItem({ palavra }: { palavra: string }) {
  const t = useT();
  const formas = usePalavraDoProduto(palavra.trim() || null);
  return (
    <>
      {" "}
      {t("Com {produtos}, a comanda abre com uma linha por {produto}.")
        .replace("{produtos}", formas.p)
        .replace("{produto}", formas.s)}
    </>
  );
}
