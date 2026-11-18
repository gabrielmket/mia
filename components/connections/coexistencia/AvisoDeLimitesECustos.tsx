"use client";
/**
 * FORK MIA · coexistência (S3): o aviso de limites e custos que abre ANTES da
 * janela da Meta (tela 2 do protótipo v3 aprovado pelo Gabriel em 17/11/2026).
 *
 * Cada linha diz de onde veio: "conferido" = estava na página da Meta lida em
 * 17/11/2026 (embedded-signup/custom-flows/onboarding-business-app-users e
 * whatsapp/pricing); "regra da MIA" = decisão nossa (D5). O que não foi
 * conferido não entra com número: o valor em reais por mensagem fica "a
 * conferir".
 */
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";

function Conferido() {
  const t = useT();
  return (
    <Badge variant="success" className="ml-1 align-middle font-normal">
      {t("conferido")}
    </Badge>
  );
}

function RegraDaMia() {
  const t = useT();
  return (
    <Badge variant="default" className="ml-1 align-middle font-normal">
      {t("regra da MIA")}
    </Badge>
  );
}

function AConferir() {
  const t = useT();
  return (
    <Badge variant="warning" className="ml-1 align-middle font-normal">
      {t("a conferir")}
    </Badge>
  );
}

export function ConteudoDoAviso() {
  const t = useT();
  return (
    <div className="grid gap-4 text-sm md:grid-cols-2" data-testid="coexistencia-aviso-conteudo">
      <div>
        <h3 className="mb-2 font-medium">{t("Limites")}</h3>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            <strong>{t("O número continua no app WhatsApp Business.")}</strong>{" "}
            {t("O dono segue respondendo pelo celular, e o que ele manda e recebe aparece também na MIA")}
            <Conferido />
          </li>
          <li>
            {t("Até 20 mensagens por segundo pela API neste número")}
            <Conferido />
          </li>
          <li>
            <strong>{t("Grupos não sincronizam")}</strong>: {t("ficam só no app")}
            <Conferido />
          </li>
          <li>
            {t(
              "No número, deixam de funcionar: mensagens temporárias, ver uma vez e localização em tempo real nas conversas individuais; listas de transmissão (as que existem ficam só para leitura)",
            )}
            <Conferido />
          </li>
          <li>
            {t(
              "No app nada muda em: ligações de voz e vídeo, catálogo, pedidos, status, mensagem de saudação e de ausência, respostas rápidas, etiquetas, perfil comercial e Canais. Essas funções seguem só no app: a MIA não as vê nem as usa",
            )}
            <Conferido />
          </li>
          <li>
            <strong>{t("Aparelhos conectados são desligados")}</strong>{" "}
            {t("na conexão. Depois dá para ligar até 4 de novo, menos WhatsApp para Windows e WearOS")}
            <Conferido />
          </li>
          <li>
            <strong>{t("O canal não oficial deste número vai ser desligado.")}</strong>{" "}
            {t(
              "Se a empresa já usa este número pela conexão por QR, a MIA arquiva esse canal quando a Meta confirmar a conexão e não deixa parear o número de novo por QR enquanto a coexistência estiver ligada. A conexão de leitura do raio-X também cai",
            )}
            <RegraDaMia />
          </li>
          <li>
            <strong>{t("Abra o app no celular pelo menos a cada 14 dias.")}</strong>{" "}
            {t("Um dos motivos que a Meta dá para tirar o número da API é o celular ficar parado por cerca de 14 dias")}
            <Conferido />
          </li>
          <li>
            {t("Contatos e histórico de até 180 dias chegam uma vez só, logo depois da conexão. Mídia só das últimas 2 semanas")}
            <Conferido />
          </li>
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-medium">{t("Custos (cobrados pela Meta)")}</h3>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            {t("Mensagem respondida pelo app: continua grátis")}
            <Conferido />
          </li>
          <li>
            {t(
              "Pela API (IA e equipe na MIA), resposta dentro da conversa aberta pelo cliente: grátis só nas 1.000 primeiras por número por mês (a Meta voltou a cobrar em 01/10/2026). Passou disso, é cobrada",
            )}
            <Conferido />
          </li>
          <li>
            {t("Modelo de utilidade dentro da janela aberta: cobrado desde 01/10/2026")}
            <Conferido />
          </li>
          <li>
            {t("Lead que chega por anúncio de clique para o WhatsApp: mensagens grátis por até 7 dias")}
            <Conferido />
          </li>
          <li>
            {t("O que sai pelo app não abre nem estende a janela da API")}
            <Conferido />
          </li>
          <li>
            {t("Valor em reais por mensagem no Brasil")}
            <AConferir /> {t("na tabela de preços da Meta. A tela não mostra número que não foi conferido.")}
          </li>
        </ul>
      </div>
    </div>
  );
}

export function AvisoDeLimitesECustos({
  aberto,
  aoFechar,
  aoContinuar,
  continuando,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoContinuar: () => void;
  continuando: boolean;
}) {
  const t = useT();
  const [li, setLi] = useState(false);
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          setLi(false);
          aoFechar();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="coexistencia-aviso">
        <DialogHeader>
          <DialogTitle>{t("Antes de conectar pelo app")}</DialogTitle>
          <DialogDescription>
            {t("Conferido nas páginas da Meta em 17/11/2026.")}
          </DialogDescription>
        </DialogHeader>
        <ConteudoDoAviso />
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={li}
            onChange={(e) => setLi(e.target.checked)}
            data-testid="coexistencia-li-o-aviso"
          />
          <span>{t("Li os limites e os custos. Sei que a sincronização acontece uma vez só.")}</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("Agora não")}
          </Button>
          <Button disabled={!li || continuando} onClick={aoContinuar} data-testid="coexistencia-continuar-na-meta">
            {continuando ? t("Esperando a janela da Meta…") : t("Continuar na janela da Meta")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
