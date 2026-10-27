/**
 * FORK MIA (.96) · as frases do PAGAMENTO NO INÍCIO, em espanhol: o cadastro da
 * entrada paga, os dados fiscais, o passo "Pagamento" (Pix, cartão, boleto, a
 * conferência, o "Pagamento confirmado", o modo teste e o bloqueio no fim do
 * teste), os avisos por e-mail e a nota fiscal pelo Asaas na Conexão.
 *
 * Mora num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream ou outro dicionário do fork já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_PAGAMENTO_MIA: Traducoes = {
  // ── o passo no início ──
  "Falta só o pagamento para começar a usar o {marca}": { es: "Solo falta el pago para empezar a usar {marca}" },
  "Falta só o pagamento para continuar usando o {marca}": { es: "Solo falta el pago para seguir usando {marca}" },
  "Como você vai pagar depois do teste": { es: "Cómo vas a pagar después de la prueba" },
  "Como a empresa vai pagar depois do teste": { es: "Cómo pagará la empresa después de la prueba" },
  "A empresa espera o primeiro pagamento": { es: "La empresa espera el primer pago" },
  "Quem administra a empresa escolhe a forma de pagamento nesta tela. Avise a pessoa que administra.": {
    es: "Quien administra la empresa elige la forma de pago en esta pantalla. Avisa a la persona que administra.",
  },
  "Nada é cobrado hoje. O teste grátis vai até {data}.": { es: "Hoy no se cobra nada. La prueba gratis dura hasta el {data}." },
  "O teste grátis terminou e a primeira mensalidade ainda não foi paga. Pague por Pix ou cadastre outro cartão: a conta é liberada na hora.": {
    es: "La prueba gratis terminó y la primera mensualidad aún no se pagó. Paga por Pix o registra otra tarjeta: la cuenta se libera al instante.",
  },
  "Plano {nome}": { es: "Plan {nome}" },
  Pix: { es: "Pix" },
  Forma: { es: "Forma" },
  "Escolha o plano": { es: "Elige el plan" },
  "{n} dias de teste grátis": { es: "{n} días de prueba gratis" },
  "paga na entrada": { es: "se paga al inicio" },
  "Se já houver uma cobrança gerada, ela é cancelada e a próxima sai no plano novo.": {
    es: "Si ya hay un cobro generado, se cancela y el próximo sale con el plan nuevo.",
  },
  "Trocar para este plano": { es: "Cambiar a este plan" },
  "Cobrança e nota em nome de": { es: "Cobro y factura a nombre de" },
  Corrigir: { es: "Corregir" },
  "Salvar os dados": { es: "Guardar los datos" },
  "Os dados fiscais ficam guardados na sua conta, visíveis só para quem administra a empresa.": {
    es: "Los datos fiscales quedan guardados en tu cuenta, visibles solo para quien administra la empresa.",
  },
  "Como você quer pagar": { es: "Cómo quieres pagar" },
  "Como você quer pagar depois do teste": { es: "Cómo quieres pagar después de la prueba" },
  "Cartão de crédito": { es: "Tarjeta de crédito" },
  Boleto: { es: "Boleto bancario" },
  "Outra forma": { es: "Otra forma" },
  "Libera na hora": { es: "Se libera al instante" },
  "Libera na hora · renova sozinho": { es: "Se libera al instante · se renueva solo" },
  "Libera em 1 a 3 dias úteis": { es: "Se libera en 1 a 3 días hábiles" },
  "Cadastre agora; o débito sai sozinho no fim do teste": { es: "Regístrala ahora; el cargo sale solo al final de la prueba" },
  "O Pix chega 3 dias antes do fim do teste": { es: "El Pix llega 3 días antes del final de la prueba" },
  "Nada é cobrado hoje. 3 dias antes do fim do teste, mandamos por e-mail o Pix da primeira mensalidade. Sem o pagamento, a conta fica bloqueada no fim do teste até o Pix ser confirmado.":
    {
      es: "Hoy no se cobra nada. 3 días antes del final de la prueba, enviamos por correo el Pix de la primera mensualidad. Sin el pago, la cuenta queda bloqueada al final de la prueba hasta que se confirme el Pix.",
    },
  "Escolher o Pix": { es: "Elegir Pix" },
  "Gerar o Pix de {valor}": { es: "Generar el Pix de {valor}" },
  "QR Code do Pix": { es: "Código QR del Pix" },
  "Escaneie com o app do seu banco ou use o Pix copia e cola.": { es: "Escanea con la app de tu banco o usa el Pix copia y pega." },
  "Pix copia e cola": { es: "Pix copia y pega" },
  "Pix copia e cola:": { es: "Pix copia y pega:" },
  "Pix copia e cola copiado.": { es: "Pix copia y pega copiado." },
  "Esperando o Pix. Conferimos sozinhos a cada poucos segundos; não precisa clicar em nada.": {
    es: "Esperando el Pix. Lo verificamos solos cada pocos segundos; no hace falta hacer clic en nada.",
  },
  "A nota fiscal chega por e-mail depois que o pagamento confirmar.": { es: "La factura llega por correo después de que se confirme el pago." },
  "O Asaas está analisando o pagamento com o banco. Esta tela segue sozinha quando confirmar.": {
    es: "Asaas está analizando el pago con el banco. Esta pantalla avanza sola cuando se confirme.",
  },
  "O banco recusou o cartão. Confira os dados, tente outro cartão ou pague por Pix, que libera na hora.": {
    es: "El banco rechazó la tarjeta. Revisa los datos, prueba otra tarjeta o paga por Pix, que se libera al instante.",
  },
  "O banco recusou o cartão. Confira os dados, tente outro cartão ou escolha o Pix.": {
    es: "El banco rechazó la tarjeta. Revisa los datos, prueba otra tarjeta o elige Pix.",
  },
  "Número do cartão": { es: "Número de la tarjeta" },
  "Nome impresso no cartão": { es: "Nombre impreso en la tarjeta" },
  "MM/AA": { es: "MM/AA" },
  "Código de segurança": { es: "Código de seguridad" },
  "3 ou 4 números": { es: "3 o 4 números" },
  "Enviando ao Asaas...": { es: "Enviando a Asaas..." },
  "Cadastrar o cartão": { es: "Registrar la tarjeta" },
  "Pagar {valor}": { es: "Pagar {valor}" },
  "Nada é cobrado hoje. A primeira mensalidade, de {valor}, é debitada neste cartão em {data}, no fim do teste. Os dados do cartão vão direto para o Asaas e não ficam guardados.":
    {
      es: "Hoy no se cobra nada. La primera mensualidad, de {valor}, se carga en esta tarjeta el {data}, al final de la prueba. Los datos de la tarjeta van directo a Asaas y no quedan guardados.",
    },
  "Os dados do cartão vão direto para o Asaas na hora do pagamento e não ficam guardados. As próximas mensalidades caem no mesmo cartão, e você troca de cartão quando quiser em Configurações › Plano e cobrança.":
    {
      es: "Los datos de la tarjeta van directo a Asaas en el momento del pago y no quedan guardados. Las próximas mensualidades se cargan en la misma tarjeta, y cambias de tarjeta cuando quieras en Configuración › Plan y cobro.",
    },
  "Pagar por Pix": { es: "Pagar por Pix" },
  "Copiar a linha digitável": { es: "Copiar la línea digitable" },
  "Linha digitável copiada.": { es: "Línea digitable copiada." },
  "Abrir o boleto": { es: "Abrir el boleto" },
  "O boleto vence em {data} e compensa em 1 a 3 dias úteis. Pode fechar esta tela: quando compensar, mandamos um e-mail e a sua conta libera. Quer começar agora? Pague por Pix.":
    {
      es: "El boleto vence el {data} y se acredita en 1 a 3 días hábiles. Puedes cerrar esta pantalla: cuando se acredite, enviamos un correo y tu cuenta se libera. ¿Quieres empezar ahora? Paga por Pix.",
    },
  "Pagar por Pix em vez do boleto": { es: "Pagar por Pix en lugar del boleto" },
  "Gerar o boleto": { es: "Generar el boleto" },
  "Selecione o texto e copie.": { es: "Selecciona el texto y cópialo." },
  "Não deu para falar com o servidor. Confira a conexão e tente de novo.": {
    es: "No fue posible hablar con el servidor. Revisa la conexión e inténtalo de nuevo.",
  },
  "Pagamento processado pelo Asaas.": { es: "Pago procesado por Asaas." },
  "Pagamento confirmado": { es: "Pago confirmado" },
  "A sua conta está liberada. Agora vamos montar tudo em poucos passos.": {
    es: "Tu cuenta está liberada. Ahora vamos a armar todo en pocos pasos.",
  },
  "Confirmado em": { es: "Confirmado el" },
  "A nota fiscal sai pelo Asaas com a confirmação do pagamento, em nome dos dados fiscais da empresa, e chega no seu e-mail junto com o recibo.":
    {
      es: "La factura sale por Asaas con la confirmación del pago, a nombre de los datos fiscales de la empresa, y llega a tu correo junto con el recibo.",
    },
  "Continuar: Seu negócio": { es: "Continuar: Tu negocio" },
  "Pronto: nada é cobrado hoje": { es: "Listo: hoy no se cobra nada" },
  "A primeira mensalidade, de {valor}, será debitada no cartão final {final} em {data}, no fim do teste.": {
    es: "La primera mensualidad, de {valor}, se cargará en la tarjeta terminada en {final} el {data}, al final de la prueba.",
  },
  "O Pix da primeira mensalidade chega por e-mail 3 dias antes do fim do teste, que é em {data}.": {
    es: "El Pix de la primera mensualidad llega por correo 3 días antes del final de la prueba, que es el {data}.",
  },
  "Sem o pagamento no fim do teste, a conta fica bloqueada até ele ser confirmado.": {
    es: "Sin el pago al final de la prueba, la cuenta queda bloqueada hasta que se confirme.",
  },
  "Trocar a forma": { es: "Cambiar la forma" },

  // ── os dados fiscais (cadastro e passo) ──
  "Dados da empresa para a cobrança e a nota fiscal": { es: "Datos de la empresa para el cobro y la factura" },
  "Empresa ou pessoa física": { es: "Empresa o persona física" },
  "Empresa (CNPJ)": { es: "Empresa (CNPJ)" },
  "Nota em nome da empresa": { es: "Factura a nombre de la empresa" },
  "Pessoa física (CPF)": { es: "Persona física (CPF)" },
  "Profissional autônomo": { es: "Profesional independiente" },
  "Preencher pelo CNPJ": { es: "Completar por el CNPJ" },
  "Buscando...": { es: "Buscando..." },
  "Buscamos a razão social e o endereço na Receita. Confira antes de seguir.": {
    es: "Buscamos la razón social y la dirección en la Receita. Revisa antes de seguir.",
  },
  "Razão social e endereço preenchidos pela Receita. Confira antes de seguir.": {
    es: "Razón social y dirección completadas por la Receita. Revisa antes de seguir.",
  },
  "A consulta à Receita não respondeu agora. Preencha à mão.": { es: "La consulta a la Receita no respondió ahora. Completa a mano." },
  "A busca do CEP não respondeu agora. Preencha à mão.": { es: "La búsqueda del CEP no respondió ahora. Completa a mano." },
  UF: { es: "Estado" },
  CPF: { es: "CPF" },
  CEP: { es: "CEP" },
  "Inscrição municipal": { es: "Inscripción municipal" },
  "Inscrição estadual": { es: "Inscripción estatal" },
  "Confira este campo.": { es: "Revisa este campo." },
  "Preencha este campo.": { es: "Completa este campo." },
  "Falta preencher:": { es: "Falta completar:" },
  "Criar conta e ir para o pagamento": { es: "Crear cuenta e ir al pago" },
  // os nomes dos campos em "Falta preencher" (lib/dados-fiscais/regras.ts)
  "empresa ou pessoa física": { es: "empresa o persona física" },
  "CPF ou CNPJ válido": { es: "CPF o CNPJ válido" },
  "razão social ou nome completo": { es: "razón social o nombre completo" },
  rua: { es: "calle" },
  complemento: { es: "complemento" },
  bairro: { es: "barrio" },
  cidade: { es: "ciudad" },
  "inscrição municipal": { es: "inscripción municipal" },
  "inscrição estadual": { es: "inscripción estatal" },
  "seu nome": { es: "tu nombre" },

  // ── os avisos por e-mail ──
  "Você gerou a cobrança do plano {plano} e o pagamento ainda não chegou.": {
    es: "Generaste el cobro del plan {plano} y el pago aún no llegó.",
  },
  "Você gerou a cobrança e o pagamento ainda não chegou.": { es: "Generaste el cobro y el pago aún no llegó." },
  "Pague por Pix ou cartão e a conta é liberada na hora. Se pagou com boleto, é só aguardar a compensação.": {
    es: "Paga por Pix o tarjeta y la cuenta se libera al instante. Si pagaste con boleto, solo espera la acreditación.",
  },
  "Voltar ao pagamento": { es: "Volver al pago" },
  "Seu teste grátis termina em {data}: o Pix da primeira mensalidade está pronto": {
    es: "Tu prueba gratis termina el {data}: el Pix de la primera mensualidad está listo",
  },
  "Pague até {data} para continuar usando sem interrupção. Sem o pagamento, a conta fica bloqueada no fim do teste até o Pix ser confirmado.":
    {
      es: "Paga hasta el {data} para seguir usando sin interrupción. Sin el pago, la cuenta queda bloqueada al final de la prueba hasta que se confirme el Pix.",
    },
  "Pagar com Pix": { es: "Pagar con Pix" },

  // ── a nota fiscal pelo Asaas (Admin › Cobrança › Conexão) ──
  "Nota fiscal pelo Asaas, na confirmação do pagamento": { es: "Factura por Asaas, al confirmarse el pago" },
  "A nota de serviço sai pelo Asaas só quando o pagamento confirma: Pix vencido, boleto cancelado e cobrança refeita nunca geram nota. Ela é emitida em nome dos dados fiscais que a empresa preencheu.":
    {
      es: "La factura de servicio sale por Asaas solo cuando se confirma el pago: Pix vencido, boleto cancelado y cobro rehecho nunca generan factura. Se emite a nombre de los datos fiscales que completó la empresa.",
    },
  "Vale para o Asaas. Com outro provedor, nada é enviado.": { es: "Vale para Asaas. Con otro proveedor, no se envía nada." },
  "Sem esta configuração, o Asaas não emite nota sozinho para as assinaturas.": {
    es: "Sin esta configuración, Asaas no emite factura solo para las suscripciones.",
  },
  "Código do serviço na prefeitura": { es: "Código del servicio en la municipalidad" },
  "Id do serviço no Asaas": { es: "Id del servicio en Asaas" },
  "Descrição do serviço": { es: "Descripción del servicio" },
  "ISS (%)": { es: "ISS (%)" },
  "PIS (%)": { es: "PIS (%)" },
  "COFINS (%)": { es: "COFINS (%)" },
  "CSLL (%)": { es: "CSLL (%)" },
  "INSS (%)": { es: "INSS (%)" },
  "IR (%)": { es: "IR (%)" },
  "Reter o ISS": { es: "Retener el ISS" },
  "Observações da nota": { es: "Observaciones de la factura" },
  "Salvar a nota fiscal": { es: "Guardar la factura" },
  "Salvo. As assinaturas recebem a configuração na próxima rodada da cobrança (de hora em hora).": {
    es: "Guardado. Las suscripciones reciben la configuración en la próxima ronda de cobro (cada hora).",
  },
  "Confira no painel do Asaas": { es: "Revisa en el panel de Asaas" },
  'Os avisos de cobrança do Asaas para os seus clientes estão DESLIGADOS (e-mail, SMS e WhatsApp). Quem avisa é este sistema: o lembrete, o "Pagamento confirmado" e a régua. O sistema já pede ao Asaas, cliente por cliente, que não mande os dele; confira também a configuração geral da conta.':
    {
      es: 'Los avisos de cobro de Asaas para tus clientes están DESACTIVADOS (correo, SMS y WhatsApp). Quien avisa es este sistema: el recordatorio, el "Pago confirmado" y la regla. El sistema ya le pide a Asaas, cliente por cliente, que no envíe los suyos; revisa también la configuración general de la cuenta.',
    },
  "A emissão de nota fiscal está ligada no Asaas, com o seu contador, e a nota sai na confirmação do pagamento, não na criação da cobrança.": {
    es: "La emisión de facturas está activada en Asaas, con tu contador, y la factura sale al confirmarse el pago, no al crearse el cobro.",
  },
};
