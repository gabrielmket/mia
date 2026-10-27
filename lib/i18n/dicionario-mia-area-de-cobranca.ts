/**
 * FORK MIA (.96, segunda frente) · as frases da ÁREA DE COBRANÇA e do LADO DA
 * TIME, em espanhol: as cobranças com a nota e o recibo, "Pagar agora" e a
 * segunda via, a troca do cartão, os dados fiscais, "A nota saiu errada", o
 * funil do cadastro, a situação do pagamento e "Apagar o cadastro".
 *
 * Mora num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream ou outro dicionário do fork já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_AREA_DE_COBRANCA_MIA: Traducoes = {
  // ── as cobranças ──
  Cobranças: { es: "Cobros" },
  "Nota fiscal e recibo": { es: "Factura fiscal y recibo" },
  "Cartão final {final}": { es: "Tarjeta terminada en {final}" },
  "Pix, boleto ou cartão": { es: "Pix, boleto o tarjeta" },
  "nota nº {n}": { es: "factura n.º {n}" },
  "paga em {data}": { es: "pagado el {data}" },
  paga: { es: "pagado" },
  "em aberto · vence {data}": { es: "pendiente · vence el {data}" },
  "vencida em {data}": { es: "vencido el {data}" },
  "pagamento em análise": { es: "pago en análisis" },
  "cancelada · sem nota": { es: "cancelado · sin factura" },
  "em andamento": { es: "en curso" },
  "Nota PDF": { es: "Factura PDF" },
  XML: { es: "XML" },
  Recibo: { es: "Recibo" },
  "A nota ainda não saiu.": { es: "La factura aún no se emitió." },
  "A nota está saindo.": { es: "La factura se está emitiendo." },
  "correção pedida · chamado nº {n}": { es: "corrección solicitada · ticket n.º {n}" },
  "correção respondida · chamado nº {n}": { es: "corrección respondida · ticket n.º {n}" },
  "Segunda via": { es: "Segunda vía" },
  "Cai sozinho no cartão final {final} em {data}.": { es: "Se cobra solo en la tarjeta terminada en {final} el {data}." },
  "Cai sozinho no cartão em {data}.": { es: "Se cobra solo en la tarjeta el {data}." },
  "Cobrança que não foi paga e foi cancelada. Não gera nota.": { es: "Cobro que no se pagó y se canceló. No genera factura." },
  "Não deu para ler as cobranças no Asaas agora. Recarregue a página em alguns minutos.": {
    es: "No fue posible leer los cobros en Asaas ahora. Recarga la página en unos minutos.",
  },
  "As cobranças aparecem aqui depois da primeira cobrança.": { es: "Los cobros aparecen aquí después del primer cobro." },
  "A nota de cada mês sai pelo Asaas quando o pagamento confirma, e fica aqui para baixar a qualquer momento.": {
    es: "La factura de cada mes la emite Asaas cuando se confirma el pago, y queda aquí para descargarla en cualquier momento.",
  },

  // ── a nota saiu errada ──
  "A nota saiu errada": { es: "La factura salió mal" },
  "O que saiu errado na nota nº {n}?": { es: "¿Qué salió mal en la factura n.º {n}?" },
  "O que saiu errado na nota?": { es: "¿Qué salió mal en la factura?" },
  "O que está errado": { es: "Qué está mal" },
  "Razão social ou nome": { es: "Razón social o nombre" },
  "CNPJ ou CPF": { es: "CNPJ o CPF" },
  "Valor ou serviço": { es: "Valor o servicio" },
  "Outra coisa": { es: "Otra cosa" },
  "Conte o que precisa mudar": { es: "Cuenta qué hay que cambiar" },
  "A Time cancela a nota no Asaas e emite outra com os dados certos, dentro do prazo da prefeitura. Se o erro está nos seus dados fiscais, corrija também em Dados fiscais, para as próximas notas.": {
    es: "El equipo de Time cancela la factura en Asaas y emite otra con los datos correctos, dentro del plazo del municipio. Si el error está en tus datos fiscales, corrígelos también en Datos fiscales, para las próximas facturas.",
  },
  "Pedir a correção": { es: "Pedir la corrección" },
  "Pedido enviado. Virou um chamado para a Time, e a resposta chega no seu e-mail.": {
    es: "Solicitud enviada. Se convirtió en un ticket para el equipo de Time, y la respuesta llega a tu correo.",
  },

  // ── a forma de pagamento ──
  "A forma de pagamento aparece aqui depois da primeira cobrança.": { es: "La forma de pago aparece aquí después del primer cobro." },
  "Número do novo cartão": { es: "Número de la nueva tarjeta" },
  "Usar este cartão": { es: "Usar esta tarjeta" },
  "O cartão vai direto para o Asaas e não fica guardado aqui. Nada é cobrado agora: ele vale para as próximas mensalidades.": {
    es: "La tarjeta va directo a Asaas y no queda guardada aquí. No se cobra nada ahora: vale para las próximas mensualidades.",
  },
  "Cartão {bandeira} terminado em {final}.": { es: "Tarjeta {bandeira} terminada en {final}." },
  "Cartão de crédito terminado em {final}.": { es: "Tarjeta de crédito terminada en {final}." },
  "Cartão de crédito.": { es: "Tarjeta de crédito." },
  "As mensalidades caem nele.": { es: "Las mensualidades se cobran en ella." },
  "As mensalidades chegam pela fatura do Asaas, para pagar por Pix ou boleto.": {
    es: "Las mensualidades llegan por la factura de Asaas, para pagar por Pix o boleto.",
  },
  "Próxima mensalidade em {data}.": { es: "Próxima mensualidad el {data}." },
  "Trocar o cartão": { es: "Cambiar la tarjeta" },
  "Cadastrar um cartão": { es: "Registrar una tarjeta" },
  "Cartão trocado. As próximas mensalidades caem no cartão novo.": {
    es: "Tarjeta cambiada. Las próximas mensualidades se cobran en la tarjeta nueva.",
  },

  // ── os dados fiscais ──
  "Dados fiscais": { es: "Datos fiscales" },
  "Dados fiscais salvos. Valem a partir da próxima nota.": { es: "Datos fiscales guardados. Valen a partir de la próxima factura." },
  "A mudança vale para as próximas notas. Uma nota já emitida se corrige por A nota saiu errada.": {
    es: "El cambio vale para las próximas facturas. Una factura ya emitida se corrige con La factura salió mal.",
  },
  "A versão mais nova ainda vai para o Asaas: chega antes da próxima nota.": {
    es: "La versión más nueva todavía va a Asaas: llega antes de la próxima factura.",
  },
  "Os dados fiscais da empresa ainda não foram preenchidos. A nota sai com eles.": {
    es: "Los datos fiscales de la empresa aún no se completaron. La factura sale con ellos.",
  },
  "O CNPJ ou CPF não muda por aqui: trocar o titular é pedido à Time.": {
    es: "El CNPJ o CPF no cambia aquí: cambiar el titular se le pide al equipo de Time.",
  },
  "Só quem administra a empresa vê as cobranças, baixa as notas, troca o cartão e edita os dados fiscais.": {
    es: "Solo quien administra la empresa ve los cobros, descarga las facturas, cambia la tarjeta y edita los datos fiscales.",
  },

  // ── o lado da Time: o funil, a situação do pagamento e o apagar ──
  "Funil do cadastro, últimos 30 dias": { es: "Embudo del registro, últimos 30 días" },
  "Não deu para contar o funil agora.": { es: "No fue posible contar el embudo ahora." },
  "escolheram um plano no site": { es: "eligieron un plan en el sitio" },
  "criaram a conta": { es: "crearon la cuenta" },
  pagaram: { es: "pagaron" },
  "esperando o pagamento": { es: "esperando el pago" },
  "sem pagamento há mais de 30 dias": { es: "sin pago hace más de 30 días" },
  "Nada é apagado sozinho: o cadastro sem pagamento há mais de 30 dias ganha o botão Apagar o cadastro, com a verificação em duas etapas.": {
    es: "Nada se borra solo: el registro sin pago hace más de 30 días recibe el botón Borrar el registro, con la verificación en dos pasos.",
  },
  "Situação do pagamento": { es: "Situación del pago" },
  "Pix gerado, sem pagamento": { es: "Pix generado, sin pago" },
  "boleto em compensação": { es: "boleto en compensación" },
  "cartão recusado": { es: "tarjeta rechazada" },
  "cartão em análise": { es: "tarjeta en análisis" },
  "nunca gerou cobrança": { es: "nunca generó cobro" },
  "sem pagamento há {dias} dias": { es: "sin pago hace {dias} días" },
  "teste · cartão cadastrado": { es: "prueba · tarjeta registrada" },
  "teste · paga por Pix no fim": { es: "prueba · paga por Pix al final" },
  cartão: { es: "tarjeta" },
  boleto: { es: "boleto" },
  "pago em {data}": { es: "pagado el {data}" },
  "vence em {data}": { es: "vence el {data}" },
  "tentou {n} vezes": { es: "lo intentó {n} veces" },
  "gerado em {data}": { es: "generado el {data}" },
  "cobrança gerada em {data}": { es: "cobro generado el {data}" },
  "o teste acabou sem pagamento": { es: "la prueba terminó sin pago" },
  "Apagar o cadastro": { es: "Borrar el registro" },
  "Apagar o cadastro de {nome}": { es: "Borrar el registro de {nome}" },
  "A empresa se cadastrou há {dias} dias e nunca pagou. Apagar tira a empresa, os dados dela e o login de quem se cadastrou, que pode se cadastrar de novo.": {
    es: "La empresa se registró hace {dias} días y nunca pagó. Borrar quita la empresa, sus datos y el acceso de quien se registró, que puede registrarse de nuevo.",
  },
  "Antes, a cobrança em aberto é cancelada no Asaas, para nada ficar cobrando. Fica o registro da exclusão na auditoria.": {
    es: "Antes, el cobro pendiente se cancela en Asaas, para que nada quede cobrando. Queda el registro de la eliminación en la auditoría.",
  },
  "Não há como desfazer.": { es: "No se puede deshacer." },
  "Para confirmar, digite o nome curto da empresa": { es: "Para confirmar, escribe el nombre corto de la empresa" },
  "Apagando...": { es: "Borrando..." },
  "Não deu para apagar agora. Tente de novo em instantes.": { es: "No fue posible borrar ahora. Inténtalo de nuevo en unos instantes." },
};
