/**
 * FORK MIA (.90) — as frases da JORNADA DE ASSINATURA (a cobrança): a página de
 * preços, os cartões do cadastro, o plano que libera módulo, o uso de IA em %,
 * os créditos por Pix, a tela das empresas que entraram sozinhas e os avisos
 * dos módulos que seguem o plano, em espanhol.
 *
 * Mora num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DA_JORNADA_MIA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o texto em
 * português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_JORNADA_MIA: Traducoes = {
  // ── os módulos do plano (lib/planos-mia/catalogo.ts) ──
  "Mensagem para uma lista, pelo número oficial ou pelo QR, com créditos.": {
    es: "Mensaje para una lista, por el número oficial o por QR, con créditos.",
  },
  "Campanhas pelo domínio da empresa, com descadastro e supressão.": {
    es: "Campañas desde el dominio de la empresa, con baja y supresión.",
  },
  "Vendas B2B": { es: "Ventas B2B" },
  "Empresas por CNPJ, decisores, planilha e propostas com PDF.": {
    es: "Empresas por CNPJ, tomadores de decisión, planilla y propuestas con PDF.",
  },
  "pelo plano": { es: "por el plan" },
  "pela Time": { es: "por el equipo de Time" },
  "pelo plano e pela Time": { es: "por el plan y por el equipo de Time" },

  // ── os avisos dos módulos que seguem o plano (lib/planos-mia/seguir-o-plano.ts) ──
  "{modulo} ligado pelo plano {plano}": { es: "{modulo} activado por el plan {plano}" },
  "da empresa": { es: "de la empresa" },
  "O {modulo} entrou no plano da empresa e já aparece no menu.": {
    es: "{modulo} entró en el plan de la empresa y ya aparece en el menú.",
  },
  "{modulo} desligado: saiu do plano": { es: "{modulo} desactivado: salió del plan" },
  "O plano da empresa não inclui mais o {modulo}. A tela e o envio param; os dados ficam guardados. Para voltar, troque de plano em Plano e cobrança.":
    {
      es: "El plan de la empresa ya no incluye {modulo}. La pantalla y el envío se detienen; los datos quedan guardados. Para volver, cambia de plan en Plan y facturación.",
    },
  "Sai do plano em {data}: {modulos}": { es: "Sale del plan el {data}: {modulos}" },
  "A troca para o plano {plano} vale na renovação, em {data}. Nesse dia sai do plano: {modulos}. Os dados ficam guardados. Para manter, fique no plano atual em Plano e cobrança.":
    {
      es: "El cambio al plan {plano} vale en la renovación, el {data}. Ese día sale del plan: {modulos}. Los datos quedan guardados. Para mantenerlo, quédate en el plan actual en Plan y facturación.",
    },

  // ── o uso de IA em % (lib/cobranca/rodada.ts e o motor, FORK MIA) ──
  "Neste mês a empresa já usou {pct}% da IA incluída no plano. Em 100%, a IA para até o mês virar e as conversas novas vão para a equipe. Para aumentar, troque de plano em Plano e cobrança.":
    {
      es: "Este mes la empresa ya usó el {pct}% de la IA incluida en el plan. Al 100%, la IA se detiene hasta que cambie el mes y las conversaciones nuevas pasan al equipo. Para aumentarla, cambia de plan en Plan y facturación.",
    },
  "O uso de IA incluído no plano acabou neste mês. As conversas foram para a equipe. Troque de plano em Configurações › Plano e cobrança ou aguarde o próximo mês.":
    {
      es: "El uso de IA incluido en el plan se agotó este mes. Las conversaciones pasaron al equipo. Cambia de plan en Configuración › Plan y facturación o espera al próximo mes.",
    },
};
