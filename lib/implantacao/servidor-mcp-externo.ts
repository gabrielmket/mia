/**
 * FORK MIA (.81) — o SERVIDOR MCP EXTERNO de um cliente (upstream: registro da
 * 0580, tela na v1.83, #2147/#2948): o endereço e a chave do sistema de fora
 * (o ERP do cliente) que a IA da empresa pode consultar.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * `definirServidorMcpExterno` (Server Action, só o dono da instalação):
 * `conferirEndpointSeguro` no cadastro (o guard anti-SSRF dos webhooks de
 * saída), `mesclarServidorMcpExterno` (o endereço no `settings.mcp_externo`,
 * mesclado em dois níveis), a CHAVE cifrada nas colunas `mcp_externo_chave_*`
 * (`cifrarChaveMcpExterno`; nunca no jsonb, que todo membro lê), apagar com
 * endereço e chave vazios, e a auditoria `org.mcp_externo_registrado` com SÓ o
 * host. O token de plataforma é o dono da instalação, como a tela exige.
 *
 * ── O que nunca sai daqui ─────────────────────────────────────────────────
 *
 * A chave entra e não volta: a resposta diz só os quatro últimos caracteres,
 * como a tela. O endereço volta só como host (pode trazer caminho de terceiro).
 *
 * ── A empresa de demonstração ─────────────────────────────────────────────
 *
 * Recusada antes do banco (o banco recusa também, 9043): da demonstração nada
 * sai, e o servidor externo é rede para o sistema de outra pessoa. Apagar
 * continua valendo, como na tela.
 */
import { audit } from "@/lib/audit";
import { FRASE_DA_DEMONSTRACAO } from "@/lib/demonstracao/trava";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import {
  conferirEndpointSeguro,
  hostDoEndpoint,
  lerEndpointMcpExterno,
  mesclarServidorMcpExterno,
} from "@/lib/mcp/servidor-externo/registro";
import { abrirChaveMcpExterno, cifrarChaveMcpExterno, SEGREDO_APAGADO } from "@/lib/mcp/servidor-externo/segredo";

import { mudarSettingsDaOrganizacao, type Desfecho, type Implantacao, type OrganizacaoDaImplantacao } from "./base";

export interface PedidoDoServidorExterno {
  /** O endereço https PÚBLICO do servidor MCP do cliente. */
  endereco?: string;
  /** A chave de acesso. Entra cifrada e nunca volta. */
  chave?: string;
  /** `true` apaga o endereço e a chave: a IA deixa de alcançar o servidor. */
  apagar?: boolean;
}

export interface ServidorExternoConfigurado {
  servidor: { registrado: boolean; host: string | null; chave_termina_em: string | null };
  desfecho: Desfecho;
  avisos: string[];
}

const COLUNAS = "settings, mcp_externo_chave_encrypted, mcp_externo_chave_iv, mcp_externo_chave_tag, mcp_externo_chave_last4";

export async function configurarServidorMcpExterno(
  c: Implantacao,
  org: Pick<OrganizacaoDaImplantacao, "demonstracao">,
  pedido: PedidoDoServidorExterno,
): Promise<ServidorExternoConfigurado> {
  const apagando = pedido.apagar === true;
  const endereco = (pedido.endereco ?? "").trim();
  const chave = (pedido.chave ?? "").trim();
  if (!apagando && (!endereco || !chave)) {
    throw new Recusa(
      "Informe `endereco` e `chave` juntos (o servidor MCP do sistema do cliente e a chave de acesso), ou `apagar: true` para tirar o servidor. " +
        'Ex.: { "endereco": "https://erp.example.com/mcp", "chave": "<a chave que o sistema do cliente deu>" }',
    );
  }
  if (!apagando && org.demonstracao) {
    throw new Recusa(
      `${FRASE_DA_DEMONSTRACAO} O servidor MCP externo é a IA consultando o sistema de outra empresa pela rede, e por isso não se cadastra na demonstração.`,
    );
  }
  if (!apagando) {
    try {
      conferirEndpointSeguro(endereco);
    } catch {
      throw new Recusa(
        "Endereço recusado por segurança: informe um servidor público em https, sem rede interna, sem localhost e sem segredo colado no endereço (`?token=`). " +
          "A chave vai no campo `chave`.",
      );
    }
  }

  const { data: atual, error } = await c.admin.from("organizations").select(COLUNAS).eq("id", c.orgId).maybeSingle();
  if (error) throw new Error(`não consegui ler o servidor MCP externo: ${error.message}`);
  const linha = (atual ?? {}) as {
    settings?: unknown;
    mcp_externo_chave_encrypted?: string;
    mcp_externo_chave_iv?: string;
    mcp_externo_chave_tag?: string;
    mcp_externo_chave_last4?: string | null;
  };
  const enderecoAtual = lerEndpointMcpExterno(linha.settings);
  const chaveAtual = abrirChaveMcpExterno({
    mcp_externo_chave_encrypted: linha.mcp_externo_chave_encrypted,
    mcp_externo_chave_iv: linha.mcp_externo_chave_iv,
    mcp_externo_chave_tag: linha.mcp_externo_chave_tag,
  });

  if (apagando ? enderecoAtual === null && chaveAtual === null : enderecoAtual === endereco && chaveAtual === chave) {
    return {
      servidor: {
        registrado: !apagando,
        host: apagando ? null : hostDoEndpoint(endereco),
        chave_termina_em: apagando ? null : chave.slice(-4),
      },
      desfecho: "ja_estava",
      avisos: [],
    };
  }

  // O segredo sai cifrado (ou zerado), no MESMO update do endereço.
  const colunas: Record<string, unknown> = apagando ? { ...SEGREDO_APAGADO } : { ...cifrarChaveMcpExterno(chave) };
  const { mudou } = await mudarSettingsDaOrganizacao(
    c.admin,
    c.orgId,
    (settings) => mesclarServidorMcpExterno(settings, apagando ? { endpoint: "", chave: "" } : { endpoint: endereco, chave }),
    colunas,
  );
  const registrado = !apagando;
  void audit({
    action: "org.mcp_externo_registrado",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "organization",
    resourceId: c.orgId,
    requestId: c.requestId,
    // FORMA, nunca credencial: o endereço só como HOST, e da chave nem os últimos 4.
    metadata: { endpoint: registrado ? hostDoEndpoint(endereco) : null, registrado, chave_presente: registrado, via: "mcp_plataforma" },
  });

  const avisos = registrado
    ? [
        "A IA só usa as ferramentas do servidor que forem ESCOLHIDAS no agente (plataforma_garantir_agente, `servidor_mcp_externo.ferramentas`). " +
          "Em conversa com cliente, só com `servidor_mcp_externo.no_atendimento: true`, e aí o servidor recebe a identidade do cliente da conversa (id, telefone, canal).",
        "A lista do que o servidor oferece é lida pela tela Configurações › Servidor MCP externo (ou no editor do agente), que fala com ele: por aqui nada é chamado.",
      ]
    : ["O servidor foi tirado: a IA desta empresa não alcança mais o sistema de fora. As ferramentas remotas escolhidas no agente param de montar."];
  return {
    servidor: { registrado, host: registrado ? hostDoEndpoint(endereco) : null, chave_termina_em: registrado ? chave.slice(-4) : null },
    desfecho: mudou ? "atualizou" : "ja_estava",
    avisos,
  };
}

/** O retrato para as leituras: se há servidor, o host e o final da chave. Nunca o endereço inteiro nem a chave. */
export function retratoDoServidorExterno(linha: { settings?: unknown; mcp_externo_chave_last4?: string | null }): {
  registrado: boolean;
  host: string | null;
  chave_termina_em: string | null;
} {
  const endereco = lerEndpointMcpExterno(linha.settings);
  return {
    registrado: endereco !== null,
    host: endereco ? hostDoEndpoint(endereco) : null,
    chave_termina_em: endereco ? (linha.mcp_externo_chave_last4 ?? null) : null,
  };
}
