/**
 * FORK MIA — as MENSAGENS PRONTAS de um cliente: as respostas prontas da equipe
 * e os modelos oficiais do WhatsApp.
 *
 * São duas coisas com o mesmo nome na boca de quem usa, e de naturezas opostas:
 *
 *  - RESPOSTA PRONTA (`message_templates`): um texto que o atendente insere na
 *    conversa pelo atalho. É configuração da empresa, não sai dela, e não
 *    depende de canal nenhum. Grava como `POST /api/v1/message-templates` com
 *    `shared: true` (a compartilhada da empresa, sem dono).
 *
 *  - MODELO OFICIAL (`meta_templates`): um texto SUBMETIDO À META para
 *    aprovação, usado para falar com o cliente fora da janela de 24 horas. É um
 *    ato que fala em nome da marca: uma reprovação pesa na conta inteira. Usa
 *    as funções de `POST /api/v1/channels/templates/criar` (`criarTemplate`,
 *    `credenciaisDaOrg`, `syncTemplates`) e só acontece quando a empresa tem o
 *    número OFICIAL dela conectado.
 *
 * ── As duas travas do modelo oficial ──────────────────────────────────────
 *
 * 1. `credenciaisDaOrg` cai para a conta da INSTALAÇÃO quando a empresa não tem
 *    canal oficial. Na tela isso serve a quem instalou para si; por ferramenta
 *    deixaria um token submeter modelo na conta da plataforma em nome de um
 *    cliente sem número. Por isso aqui a empresa precisa ter o canal oficial
 *    DELA, vivo, antes de qualquer chamada para fora.
 * 2. A empresa de demonstração não submete nada: a recusa vem antes, com a
 *    frase da trava.
 *
 * Modelo com cabeçalho de imagem, vídeo ou documento exige subir a amostra:
 * fica na tela.
 *
 * ── As imagens da resposta pronta (.81, upstream #2526) ───────────────────
 *
 * Até 5 imagens (JPG ou PNG, até 5 MB) que vão junto com o texto, no bucket
 * PRIVADO do atendimento. O upstream sobe uma a uma
 * (`POST /message-templates/:id/midias`) e REMOVE pelo PATCH com a lista que
 * fica; aqui `imagens` é a lista INTEIRA, por endereço https público: a que
 * falta é baixada (com as guardas do download da migração) e conferida pelos
 * BYTES (`farejarTipo`), a que sobra sai da linha e só depois do bucket. O
 * nome do arquivo sai do CONTEÚDO: a mesma imagem de novo é o mesmo caminho, e
 * repetir a chamada não empilha cópias.
 *
 * ── A ordem da resposta pronta (.86, upstream 0729, #3244) ───────────────
 *
 * A lista passou a ter ORDEM própria (`message_templates.ordem`), que a tela
 * muda arrastando e o atalho do Inbox respeita. A rota grava a resposta NOVA
 * no topo, um passo acima da primeira (`posicaoEntre`). Aqui é igual, com um
 * cuidado a mais por ser em lote: as novas de uma chamada entram no topo NA
 * ORDEM em que vieram (a primeira da lista fica em cima). A que já existe não
 * muda de lugar: a ordem é escolha de quem usa a tela.
 */
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { criarTemplate } from "@/lib/channels/meta/criar-template";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { syncTemplates } from "@/lib/channels/meta/template-sync";
import { FRASE_DA_DEMONSTRACAO } from "@/lib/demonstracao/trava";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { createTemplateSchema } from "@/lib/schemas/templates";
// A v1.87 (#2833) trocou o farejador das mídias da resposta rápida para o que
// aceita áudio também; aqui a resposta pronta recebe IMAGENS, então o
// farejador continua o da imagem (o do logo, o mesmo que o upstream reusa).
import { farejarTipo } from "@/lib/branding/logo-arquivo";
import {
  BUCKET_DAS_MIDIAS,
  extensaoDaMidia,
  MAXIMO_DE_MIDIAS,
  prefixoDoTemplate,
  TAMANHO_MAXIMO_DA_MIDIA,
  type MidiaDeTemplate,
} from "@/lib/templates/midias";
import { apagarMidiasDoTemplate } from "@/lib/templates/midias-no-bucket";
import { ordemDaRenumeracao, PASSO_DA_ORDEM } from "@/lib/templates/ordem";
import { baixarArquivoPublico } from "@/lib/mcp-plataforma/importacao/download";

import { chaveDoNome, type Desfecho, type Implantacao, type OrganizacaoDaImplantacao } from "./base";

/** Quantas respostas prontas uma chamada aceita. */
export const TETO_DE_RESPOSTAS = 50;

export interface RespostaPedida {
  titulo: string;
  texto: string;
  atalho?: string | null;
  /**
   * .81 — as imagens que vão junto com o texto (até 5), por endereço https
   * público. A lista é a INTEIRA: a que não vier sai. Ausente: ficam as que estão.
   */
  imagens?: string[];
}

export async function lerRespostasProntas(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("message_templates")
    .select("id, title, body, shortcut, owner_user_id, updated_at, midias")
    .eq("organization_id", orgId)
    .is("owner_user_id", null)
    .order("title");
  if (error) throw new Error(`não consegui ler as respostas prontas: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    title: string;
    body: string;
    shortcut: string | null;
    midias?: MidiaDeTemplate[] | null;
  }>;
}

export async function garantirRespostasProntas(
  c: Implantacao,
  pedidas: RespostaPedida[],
): Promise<Array<{ id: string; titulo: string; desfecho: Desfecho }>> {
  const existentes = await lerRespostasProntas(c.admin, c.orgId);
  const resultado: Array<{ id: string; titulo: string; desfecho: Desfecho }> = [];
  // A posição das NOVAS: no topo, na ordem do pedido. A primeira da lista da
  // organização é a de menor `ordem` entre TODAS (as pessoais também), como na
  // rota de criação.
  const novas = pedidas.filter((p) => !existentes.some((e) => chaveDoNome(e.title) === chaveDoNome(p.titulo))).length;
  const { data: primeira, error: erroDaPrimeira } = await c.admin
    .from("message_templates")
    .select("ordem")
    .eq("organization_id", c.orgId)
    .order("ordem", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (erroDaPrimeira) throw new Error(`não consegui ler a ordem das respostas prontas: ${erroDaPrimeira.message}`);
  const menor = (primeira as { ordem: number | string } | null)?.ordem ?? null;
  let criadas = 0;
  const ordemDaNova = (): number => {
    const k = criadas++;
    return menor === null ? ordemDaRenumeracao(k) : Number(menor) - (novas - k) * PASSO_DA_ORDEM;
  };

  for (const [i, pedida] of pedidas.entries()) {
    const lido = createTemplateSchema.safeParse({
      title: pedida.titulo,
      body: pedida.texto,
      ...(pedida.atalho ? { shortcut: pedida.atalho } : {}),
      shared: true,
    });
    if (!lido.success) {
      throw new Recusa(
        `respostas[${i}] não passou na conferência: \`titulo\` tem de 1 a 80 caracteres, \`texto\` de 1 a 4096 e \`atalho\` de 1 a 40.`,
      );
    }
    const { title, body, shortcut } = lido.data;
    const existente = existentes.find((e) => chaveDoNome(e.title) === chaveDoNome(title));

    if (!existente) {
      const { data, error } = await c.admin
        .from("message_templates")
        .insert({
          organization_id: c.orgId,
          // Compartilhada da empresa: sem dono.
          owner_user_id: null,
          title,
          body,
          shortcut: shortcut ?? null,
          created_by_user_id: c.autorUserId,
          ordem: ordemDaNova(),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`não consegui criar a resposta pronta «${title}»: ${error?.message ?? "sem linha"}`);
      const id = (data as { id: string }).id;
      if (pedida.imagens !== undefined && pedida.imagens.length > 0) {
        await gravarImagens(c, id, [], pedida.imagens);
      }
      void audit({
        action: "template.created",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "message_template",
        resourceId: id,
        requestId: c.requestId,
        metadata: { shared: true, title, via: "mcp_plataforma" },
      });
      resultado.push({ id, titulo: title, desfecho: "criou" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (existente.body !== body) patch.body = body;
    if (pedida.atalho !== undefined && (existente.shortcut ?? null) !== (shortcut ?? null)) patch.shortcut = shortcut ?? null;
    const imagensMudaram =
      pedida.imagens !== undefined ? await gravarImagens(c, existente.id, existente.midias ?? [], pedida.imagens) : false;
    if (Object.keys(patch).length === 0) {
      resultado.push({ id: existente.id, titulo: existente.title, desfecho: imagensMudaram ? "atualizou" : "ja_estava" });
      continue;
    }
    const { error } = await c.admin
      .from("message_templates")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", existente.id)
      .eq("organization_id", c.orgId);
    if (error) throw new Error(`não consegui atualizar a resposta pronta «${title}»: ${error.message}`);
    resultado.push({ id: existente.id, titulo: existente.title, desfecho: "atualizou" });
  }
  return resultado;
}

/**
 * As imagens de UMA resposta pronta: a lista pedida (endereços) vira a lista da
 * linha. Devolve se mudou. A ordem é a do pedido.
 */
async function gravarImagens(
  c: Implantacao,
  templateId: string,
  atuais: readonly MidiaDeTemplate[],
  enderecos: readonly string[],
): Promise<boolean> {
  if (enderecos.length > MAXIMO_DE_MIDIAS) {
    throw new Recusa(`Cada resposta pronta tem no máximo ${MAXIMO_DE_MIDIAS} imagens.`);
  }
  const prefixo = prefixoDoTemplate(c.orgId, templateId);
  const desejadas: MidiaDeTemplate[] = [];
  for (const [i, endereco] of enderecos.entries()) {
    let bytes: Uint8Array;
    try {
      bytes = (await baixarArquivoPublico(endereco, TAMANHO_MAXIMO_DA_MIDIA, `imagens[${i}]`)).bytes;
    } catch (err) {
      throw new Recusa(err instanceof Error ? err.message : `Não consegui baixar a imagem ${i + 1}.`);
    }
    const tipo = farejarTipo(bytes);
    if (!tipo) throw new Recusa(`A imagem ${i + 1} (${endereco}) precisa ser JPG ou PNG (conferido pelo conteúdo do arquivo).`);
    const caminho = `${prefixo}${nomePeloConteudo(bytes)}.${extensaoDaMidia(tipo)}`;
    if (desejadas.some((d) => d.storage_path === caminho)) continue;
    const jaTem = atuais.find((a) => a.storage_path === caminho);
    if (!jaTem) {
      const { error } = await c.admin.storage.from(BUCKET_DAS_MIDIAS).upload(caminho, bytes, { contentType: tipo, upsert: true });
      if (error) throw new Error(`não consegui subir a imagem ${i + 1}: ${error.message}`);
    }
    desejadas.push(jaTem ?? { storage_path: caminho, media_mime: tipo, media_size_bytes: bytes.byteLength });
  }
  const mesmas =
    desejadas.length === atuais.length && desejadas.every((d, i) => d.storage_path === atuais[i]!.storage_path);
  if (mesmas) return false;

  const { error } = await c.admin
    .from("message_templates")
    .update({ midias: desejadas, updated_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("organization_id", c.orgId);
  if (error) throw new Error(`não consegui gravar as imagens da resposta pronta: ${error.message}`);
  // A que saiu da lista sai do bucket SÓ DEPOIS da linha gravada (como o PATCH da rota).
  const removidas = atuais.map((a) => a.storage_path).filter((p) => !desejadas.some((d) => d.storage_path === p) && p.startsWith(prefixo));
  if (removidas.length > 0) await apagarMidiasDoTemplate(removidas, c.requestId);
  const novas = desejadas.filter((d) => !atuais.some((a) => a.storage_path === d.storage_path)).length;
  if (novas > 0) {
    void audit({
      action: "template.media_added",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "message_template",
      resourceId: templateId,
      requestId: c.requestId,
      metadata: { total: desejadas.length, novas, via: "mcp_plataforma" },
    });
  }
  if (removidas.length > 0) {
    void audit({
      action: "template.updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "message_template",
      resourceId: templateId,
      requestId: c.requestId,
      metadata: { fields: ["midias"], removidas: removidas.length, via: "mcp_plataforma" },
    });
  }
  return true;
}

/** O nome do arquivo a partir do CONTEÚDO, na forma `8-4-4-4-12` que `midiaPertenceAoTemplate` exige. */
function nomePeloConteudo(bytes: Uint8Array): string {
  const h = createHash("sha256").update(bytes).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// modelo oficial do WhatsApp
// ---------------------------------------------------------------------------

export interface ModeloPedido {
  nome: string;
  idioma?: string;
  categoria: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  texto: string;
  exemplos?: string[];
  botoes?: string[];
  cabecalho?: string;
  rodape?: string;
}

export async function lerModelosOficiais(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("meta_templates")
    .select("id, name, language, status, category, rejected_reason")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw new Error(`não consegui ler os modelos oficiais: ${error.message}`);
  return (data ?? []) as Array<{ id: string; name: string; language: string; status: string; category: string | null; rejected_reason: string | null }>;
}

/** A empresa tem o número OFICIAL dela conectado? (canal vivo, com conta de WhatsApp Business) */
export async function temCanalOficialProprio(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, meta_waba_id, archived_at")
    .eq("organization_id", orgId)
    .is("archived_at", null);
  if (error) throw new Error(`não consegui ler os canais da organização: ${error.message}`);
  return ((data ?? []) as Array<{ meta_waba_id: string | null }>).some((s) => Boolean(s.meta_waba_id));
}

export async function submeterModeloOficial(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: ModeloPedido,
): Promise<{ modelo: { nome: string; idioma: string; situacao: string }; desfecho: "submeteu" | "ja_existia"; avisos: string[] }> {
  if (org.demonstracao) {
    throw new Recusa(`${FRASE_DA_DEMONSTRACAO} Submeter um modelo é falar com a Meta em nome da marca, então não acontece aqui.`);
  }
  const idioma = pedido.idioma ?? "pt_BR";

  if (!(await temCanalOficialProprio(c.admin, c.orgId))) {
    throw new Recusa(
      "Esta organização não tem o número OFICIAL do WhatsApp conectado, e modelo oficial só existe na conta oficial dela. " +
        "Conectar o número é com uma pessoa, em Conexões (/app/connections). Com número por QR Code não há modelo oficial: o agente fala livremente.",
    );
  }

  const existentes = await lerModelosOficiais(c.admin, c.orgId);
  const jaExiste = existentes.find((m) => m.name === pedido.nome && m.language === idioma);
  if (jaExiste) {
    return {
      modelo: { nome: jaExiste.name, idioma: jaExiste.language, situacao: jaExiste.status },
      desfecho: "ja_existia",
      avisos:
        jaExiste.status === "REJECTED"
          ? [`A Meta reprovou este modelo${jaExiste.rejected_reason ? ` (${jaExiste.rejected_reason})` : ""}. Um modelo reprovado não é reenviado com o mesmo nome: submeta com outro nome e o texto corrigido.`]
          : [],
    };
  }

  const credenciais = await credenciaisDaOrg(c.orgId);
  if (!credenciais) {
    throw new Recusa(
      "O canal oficial desta organização está sem credencial utilizável. Uma pessoa reconecta o número em Conexões (/app/connections).",
    );
  }

  const r = await criarTemplate({
    name: pedido.nome,
    language: idioma,
    category: pedido.categoria,
    body: pedido.texto,
    ...(pedido.exemplos ? { exemplos: pedido.exemplos } : {}),
    ...(pedido.botoes ? { botoes: pedido.botoes } : {}),
    ...(pedido.cabecalho ? { header: pedido.cabecalho } : {}),
    ...(pedido.rodape ? { footer: pedido.rodape } : {}),
    wabaId: credenciais.wabaId,
    token: credenciais.token,
    graphVersion: credenciais.graphVersion,
  });
  if (!r.criado) {
    if (r.motivo === "api_error") throw new Error(`a Meta não aceitou o modelo: ${r.detalhe}`);
    throw new Recusa(
      `O modelo não foi submetido: ${r.detalhe}. ` +
        'O nome usa só minúsculas, números e sublinhado (ex.: "lembrete_de_consulta"), e cada variável {{1}}, {{2}} do texto precisa de um exemplo em `exemplos`, na ordem.',
    );
  }

  void audit({
    action: "channels.template_criado",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    requestId: c.requestId,
    metadata: { name: pedido.nome, language: idioma, status: r.status, via: "mcp_plataforma" },
  });

  // Sincroniza na hora para o modelo aparecer na lista com o estado que a Meta devolveu.
  try {
    await syncTemplates({
      organizationId: c.orgId,
      wabaId: credenciais.wabaId,
      token: credenciais.token,
      graphVersion: credenciais.graphVersion,
    });
  } catch {
    // A criação JÁ aconteceu: a lista reflete no próximo sincronismo.
  }

  return {
    modelo: { nome: pedido.nome, idioma, situacao: r.status },
    desfecho: "submeteu",
    avisos: ["O modelo nasce PENDENTE: quem aprova é a Meta, e a situação muda sozinha quando ela responder."],
  };
}
