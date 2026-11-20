/**
 * FORK MIA (upstream 1.118, migration 9416, #3868, MIA-79) — o MÓDULO OPCIONAL
 * POR EMPRESA: a exceção de uma empresa ao interruptor da instalação.
 *
 * É o módulo do UPSTREAM (`organization_modules`, a tela "Por empresa" de
 * `/admin/sistema`), como ele é. Não é o módulo VENDÁVEL do fork
 * (`mia_modulos_contratados`, `plataforma_liberar_modulo`): as duas camadas
 * convivem e respondem perguntas diferentes (seção 3 do PR #113). Nada aqui lê
 * ou escreve a nossa.
 *
 * ── As regras são as da ação da tela (`updateModuloDaEmpresa`) ───────────
 *
 *   - três estados: `herda` (sem linha: segue a instalação), `ligado` e
 *     `desligado`. Gravar `herda` APAGA a linha da empresa, e só ela;
 *   - só os módulos de `MODULOS_POR_EMPRESA` (cobrança, login do Codex e os
 *     módulos de tabela ficam de fora, pela lista do upstream);
 *   - a instalação é TETO: ligar para a empresa um módulo desligado na
 *     instalação é recusado (a linha mentiria), e o que ainda não se liga
 *     (`MODULOS_AINDA_NAO_LIGAVEIS`) também;
 *   - desligar não apaga nada do módulo: só esconde; religar traz de volta;
 *   - a trilha é a mesma (`organization.modulo_updated`, com o de e o para).
 *
 * A leitura e a regra do "efetivo" são as do upstream
 * (`lerModulosDaEmpresa`, `resolverModulosDaEmpresa`). Pedido igual ao estado
 * gravado não escreve nem audita.
 *
 * A ação da tela mora num arquivo "use server" com a sessão do admin de
 * plataforma, e por isso não é chamável daqui: a sequência é um ESPELHO dela,
 * com a impressão registrada em `tests/unit/mcp-de-implantacao-espelhos.test.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import {
  MODULOS_AINDA_NAO_LIGAVEIS,
  modulosLigados,
  type ModuloPorEmpresa,
} from "@/lib/instalacao/modulos";
import {
  lerModulosDaEmpresa,
  type EstadoDoModuloNaEmpresa,
  type ModuloNaEmpresa,
} from "@/lib/instalacao/modulos-por-empresa";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import type { Implantacao } from "./base";

export type DesfechoDoModulo = "ligou" | "desligou" | "voltou_ao_padrao" | "ja_estava";

/** Como a leitura do MCP mostra cada módulo (os nomes da tela, em português). */
export function retratoDoModulo(m: ModuloNaEmpresa) {
  return {
    modulo: m.modulo,
    estado: m.estado,
    efetivo: m.efetivo,
    bloqueado_pela_instalacao: m.bloqueadoPelaInstalacao,
  };
}

/** Os módulos opcionais da empresa, ou `"nao_lido"` quando a leitura falha (nunca lança). */
export async function lerModulosOpcionaisDaEmpresa(admin: SupabaseClient, orgId: string) {
  const lidos = await lerModulosDaEmpresa(admin, orgId, await modulosLigados(admin));
  return lidos === null ? ("nao_lido" as const) : lidos.map(retratoDoModulo);
}

export interface PedidoDoModuloDaEmpresa {
  modulo: ModuloPorEmpresa;
  estado: EstadoDoModuloNaEmpresa;
}

export async function definirModuloDaEmpresa(c: Implantacao, pedido: PedidoDoModuloDaEmpresa) {
  const { modulo, estado } = pedido;

  if (estado === "ligado" && MODULOS_AINDA_NAO_LIGAVEIS.includes(modulo)) {
    throw new Recusa(`O módulo «${modulo}» ainda não se liga: o produto não terminou a parte dele. Nada foi gravado.`);
  }

  const { data: anterior, error: erroDaLeitura } = await c.admin
    .from("organization_modules")
    .select("estado")
    .eq("organization_id", c.orgId)
    .eq("modulo", modulo)
    .maybeSingle();
  if (erroDaLeitura) throw new Error(`não consegui ler o módulo da empresa: ${erroDaLeitura.message}`);
  const de: EstadoDoModuloNaEmpresa =
    anterior === null ? "herda" : (anterior as { estado: string }).estado === "ligado" ? "ligado" : "desligado";

  const naInstalacao = await modulosLigados(c.admin);
  if (estado === "ligado" && !naInstalacao.includes(modulo)) {
    throw new Recusa(
      `O módulo «${modulo}» está DESLIGADO na instalação, e a instalação é o teto: ligado para a empresa, ele continuaria desligado. ` +
        "Quem administra o servidor liga primeiro em /admin/sistema (vale para todas as empresas); depois, se for o caso, desligue para as que não devem ter.",
    );
  }

  const ler = async () => {
    const lidos = await lerModulosDaEmpresa(c.admin, c.orgId, naInstalacao);
    const daqui = lidos?.find((m) => m.modulo === modulo);
    return daqui ? retratoDoModulo(daqui) : null;
  };

  if (de === estado) return { desfecho: "ja_estava" as DesfechoDoModulo, modulo: await ler() };

  if (estado === "herda") {
    const { error } = await c.admin
      .from("organization_modules")
      .delete()
      .eq("organization_id", c.orgId)
      .eq("modulo", modulo);
    if (error) throw new Error(`não consegui devolver o módulo ao padrão: ${error.message}`);
  } else {
    const { error } = await c.admin
      .from("organization_modules")
      .upsert(
        { organization_id: c.orgId, modulo, estado, updated_by: c.autorUserId },
        { onConflict: "organization_id,modulo" },
      );
    if (error) throw new Error(`não consegui gravar o módulo da empresa: ${error.message}`);
  }

  await audit({
    actorUserId: c.autorUserId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: c.orgId,
    resourceType: "organization_modules",
    requestId: c.requestId,
    action: "organization.modulo_updated",
    metadata: { modulo, de, para: estado, via: "mcp_plataforma" },
  });

  const desfecho: DesfechoDoModulo =
    estado === "herda" ? "voltou_ao_padrao" : estado === "ligado" ? "ligou" : "desligou";
  return { desfecho, modulo: await ler() };
}
