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
  "Pessoas que decidem nas empresas, consulta de CNPJ e importação de planilha.": {
    es: "Personas que deciden en las empresas, consulta de CNPJ e importación de planillas.",
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

  // ── as telas da jornada (preços, cadastro, plano e cobrança, créditos, a tela da Time) ──
  "Empresas do cadastro": { es: "Empresas del registro" },
  "Quem entrou sozinho pela página de preços e pelo cadastro: situação, plano, primeiros passos e o próximo passo da régua.":
    {
      es: "Quienes entraron solos por la página de precios y el registro: situación, plan, primeros pasos y el próximo paso del cobro.",
    },
  "Aguardando aprovação": { es: "Esperando aprobación" },
  "modo com aprovação": { es: "modo con aprobación" },
  "modo aberto": { es: "modo abierto" },
  "modo só por convite": { es: "modo solo por invitación" },
  "Em teste": { es: "En prueba" },
  "{n} de {m} testes que acabaram viraram assinatura": {
    es: "{n} de {m} pruebas que terminaron se convirtieron en suscripción",
  },
  "{valor} por mês": { es: "{valor} por mes" },
  "Em atraso · suspensas": { es: "Atrasadas · suspendidas" },
  "a régua cuida sozinha": { es: "el cobro automático se encarga" },
  "Mostrar também as implantadas pela Time": {
    es: "Mostrar también las implantadas por el equipo de Time",
  },
  "Só quem entrou sozinho": { es: "Solo quienes entraron solos" },
  "Nenhuma empresa nesta situação.": { es: "Ninguna empresa en esta situación." },
  "Primeiros passos": { es: "Primeros pasos" },
  "Próximo da régua": { es: "Próximo paso del cobro" },
  "cadastro próprio": { es: "registro propio" },
  implantação: { es: "implantación" },
  "vira {plano} em {data}": { es: "pasa a {plano} el {data}" },
  "Números oficiais esperando ligação": { es: "Números oficiales esperando conexión" },
  "Nenhum número esperando.": { es: "Ningún número esperando." },
  "Conta da Meta sem nome": { es: "Cuenta de Meta sin nombre" },
  "Entrou com o Facebook em {data}": { es: "Entró con Facebook el {data}" },
  "Confira o nome da conta da Meta antes de ligar: ligar errado faz a conversa de um cliente sair pelo número de outro. A ligação é à mão, de propósito.":
    {
      es: "Revisa el nombre de la cuenta de Meta antes de conectar: conectar mal hace que la conversación de un cliente salga por el número de otro. La conexión es manual, a propósito.",
    },
  "Abrir o cadastro incorporado": { es: "Abrir el registro integrado" },
  "Escolha uma empresa na lista.": { es: "Elige una empresa de la lista." },
  "Quem administra": { es: "Quién administra" },
  "nenhum (isenta)": { es: "ninguno (exenta)" },
  "implantação pela Time": { es: "implantación por el equipo de Time" },
  "{n} de {m}": { es: "{n} de {m}" },
  "A régua desta empresa": { es: "El cobro de esta empresa" },
  "Abrir no painel da empresa": { es: "Abrir en el panel de la empresa" },
  "Recados no zap da Time": { es: "Mensajes en el WhatsApp del equipo" },
  "Nenhum recado ainda.": { es: "Ningún mensaje todavía." },
  "O mesmo grupo interno que recebe os chamados do assistente. Só o nome da empresa e o que fazer, nunca dado do cliente final.":
    {
      es: "El mismo grupo interno que recibe los tickets del asistente. Solo el nombre de la empresa y qué hacer, nunca datos del cliente final.",
    },
  "O cadastro desta instalação não está no modo com aprovação: pedido novo não entra nesta fila.": {
    es: "El registro de esta instalación no está en modo con aprobación: una solicitud nueva no entra en esta cola.",
  },
  "plano {plano}": { es: "plan {plano}" },
  "plano padrão": { es: "plan predeterminado" },
  "não disse o que a empresa faz": { es: "no dijo qué hace la empresa" },
  "Aprovar cria a empresa no plano escolhido e o teste começa; recusar é final para aquela conta.":
    {
      es: "Aprobar crea la empresa en el plan elegido y la prueba comienza; rechazar es definitivo para esa cuenta.",
    },
  Preços: { es: "Precios" },
  "Números de WhatsApp sem limite": { es: "Números de WhatsApp sin límite" },
  "1 número de WhatsApp": { es: "1 número de WhatsApp" },
  "Até {n} números de WhatsApp": { es: "Hasta {n} números de WhatsApp" },
  "Pessoas sem limite": { es: "Personas sin límite" },
  "Até {n} pessoas na equipe": { es: "Hasta {n} personas en el equipo" },
  "Conversas com IA sem limite": { es: "Conversaciones con IA sin límite" },
  "Cerca de {n} conversas atendidas pela IA por mês": {
    es: "Cerca de {n} conversaciones atendidas por la IA al mes",
  },
  "Tudo do atendimento: agente, CRM, agenda, follow-up e relatórios": {
    es: "Todo el servicio: agente, CRM, agenda, seguimiento e informes",
  },
  "{n} dias grátis, sem cartão": { es: "{n} días gratis, sin tarjeta" },
  "Sua pré-vendedora digital no WhatsApp": { es: "Tu prevendedora digital en WhatsApp" },
  "Atende na hora, qualifica, marca na agenda e passa para a sua equipe quem está pronto para comprar. Você monta sozinho em 15 minutos.":
    {
      es: "Atiende al instante, califica, agenda y pasa a tu equipo a quien está listo para comprar. Lo configuras solo en 15 minutos.",
    },
  "Não conseguimos carregar os planos agora.": { es: "No pudimos cargar los planes ahora." },
  "Os planos estão sendo preparados.": { es: "Los planes se están preparando." },
  "Atualize a página em instantes.": { es: "Actualiza la página en unos instantes." },
  "Fale com a nossa equipe para conhecer o sistema.": {
    es: "Habla con nuestro equipo para conocer el sistema.",
  },
  "Mais escolhido": { es: "Más elegido" },
  "com mensagem a {preco}": { es: "con mensaje a {preco}" },
  "Sem Broadcast e sem e-mail marketing": { es: "Sin Broadcast y sin e-mail marketing" },
  "Começar teste grátis": { es: "Empezar prueba gratis" },
  "{n} dias grátis, sem cartão.": { es: "{n} días gratis, sin tarjeta." },
  "Entrada paga: começa quando o primeiro pagamento confirmar.": {
    es: "Entrada pagada: empieza cuando se confirme el primer pago.",
  },
  "Comparar os planos": { es: "Comparar los planes" },
  "O que vem": { es: "Qué incluye" },
  "Números de WhatsApp": { es: "Números de WhatsApp" },
  "Pessoas na equipe": { es: "Personas en el equipo" },
  "Conversas com IA por mês (cerca de)": { es: "Conversaciones con IA al mes (aprox.)" },
  "{n} dias": { es: "{n} días" },
  "entrada paga": { es: "entrada pagada" },
  "Mensagem do Broadcast": { es: "Mensaje del Broadcast" },
  "pré-paga, pelos créditos": { es: "prepago, con créditos" },
  "Prefere que a gente monte?": { es: "¿Prefieres que lo configuremos nosotros?" },
  "A nossa equipe monta o agente, o funil e as integrações, com plano negociado e implantação à parte.":
    {
      es: "Nuestro equipo configura el agente, el embudo y las integraciones, con plan negociado e implantación aparte.",
    },
  "Falar com a equipe": { es: "Hablar con el equipo" },
  "Como eu pago?": { es: "¿Cómo pago?" },
  "No cartão, cobrado sozinho todo mês.": { es: "Con tarjeta, cobrada automáticamente cada mes." },
  "Pix, boleto ou cartão, a cada fatura. A nota fiscal de serviço sai pelo Asaas, no CPF ou CNPJ de quem paga.":
    {
      es: "Pix, boleto o tarjeta, en cada factura. La factura fiscal de servicio sale por Asaas, a nombre del CPF o CNPJ de quien paga.",
    },
  "O que acontece no fim do teste?": { es: "¿Qué pasa al final de la prueba?" },
  "Três dias antes avisamos por e-mail. Se você não assinar, a conta é suspensa dois dias depois do fim do teste: a IA para de responder e nada do que você montou se perde. Assinou, volta na hora.":
    {
      es: "Tres días antes avisamos por e-mail. Si no te suscribes, la cuenta se suspende dos días después del final de la prueba: la IA deja de responder y no se pierde nada de lo que configuraste. Te suscribiste, vuelve al instante.",
    },
  "O que conta como conversa?": { es: "¿Qué cuenta como conversación?" },
  "Uma pessoa atendida pela IA. O número do plano é uma estimativa: o plano tem um limite de uso da IA por mês, e avisamos quando chegar em 80%.":
    {
      es: "Una persona atendida por la IA. El número del plan es una estimación: el plan tiene un límite de uso de IA al mes, y avisamos al llegar al 80%.",
    },
  "Posso trocar de plano?": { es: "¿Puedo cambiar de plan?" },
  "Quando quiser. No teste, a troca vale na hora. Depois dele, para cima vale ao pagar a diferença dos dias que faltam; para baixo vale na próxima renovação.":
    {
      es: "Cuando quieras. En la prueba, el cambio vale al instante. Después, hacia arriba vale al pagar la diferencia de los días que faltan; hacia abajo vale en la próxima renovación.",
    },
  "Preciso de número oficial da Meta?": { es: "¿Necesito un número oficial de Meta?" },
  "Não. Dá para começar pelo celular, lendo um QR Code. O número oficial também entra: você conecta com o Facebook e a nossa equipe liga o número à sua empresa em até 1 dia útil.":
    {
      es: "No. Puedes empezar con el celular, leyendo un código QR. El número oficial también sirve: te conectas con Facebook y nuestro equipo vincula el número a tu empresa en hasta 1 día hábil.",
    },
  "O que a sua empresa faz (opcional)": { es: "Qué hace tu empresa (opcional)" },
  "Ex.: clínica odontológica com avaliação e limpeza": {
    es: "Ej.: clínica odontológica con evaluación y limpieza",
  },
  "cerca de {n} conversas": { es: "cerca de {n} conversaciones" },
  "Conversas com IA por mês": { es: "Conversaciones con IA al mes" },
  "{pct}% do incluído": { es: "{pct}% de lo incluido" },
  "Cerca de {n} conversas por mês. Aviso em 80%.": {
    es: "Cerca de {n} conversaciones al mes. Aviso al 80%.",
  },
  "A IA parou: o plano chegou ao limite do mês. As conversas novas estão na fila da equipe; nada se perdeu. Volta na virada do mês ou ao subir de plano.":
    {
      es: "La IA se detuvo: el plan llegó al límite del mes. Las conversaciones nuevas están en la cola del equipo; no se perdió nada. Vuelve al cambiar el mes o al subir de plan.",
    },
  "Você usou {pct}% da IA incluída no mês. Em 100%, a IA para até o mês virar e as conversas novas vão para a equipe. Subir de plano vale na hora.":
    {
      es: "Usaste el {pct}% de la IA incluida en el mes. Al 100%, la IA se detiene hasta que cambie el mes y las conversaciones nuevas pasan al equipo. Subir de plan vale al instante.",
    },
  "números sem limite": { es: "números sin límite" },
  "1 número": { es: "1 número" },
  "{n} números": { es: "{n} números" },
  "pessoas sem limite": { es: "personas sin límite" },
  "até {n} pessoas": { es: "hasta {n} personas" },
  "conversas com IA sem limite": { es: "conversaciones con IA sin límite" },
  "/ano": { es: "/año" },
  "/mês": { es: "/mes" },
  "{n} dias de teste": { es: "{n} días de prueba" },
  "Veio da página de preços com o plano marcado. Dá para trocar aqui ou depois, no teste.": {
    es: "Viniste de la página de precios con el plan marcado. Puedes cambiarlo aquí o después, en la prueba.",
  },
  "Dá para trocar de plano depois, inclusive durante o teste.": {
    es: "Puedes cambiar de plan después, incluso durante la prueba.",
  },
  "Não consegui carregar a compra de créditos agora.": {
    es: "No pude cargar la compra de créditos ahora.",
  },
  "Não foi possível gerar o Pix. Tente de novo.": {
    es: "No fue posible generar el Pix. Inténtalo de nuevo.",
  },
  "Pagamento confirmado. Os créditos já estão na carteira.": {
    es: "Pago confirmado. Los créditos ya están en la cartera.",
  },
  "Este Pix não vale mais. Gere outro.": { es: "Este Pix ya no vale. Genera otro." },
  "Ainda não identificamos o pagamento. Pix confirma em minutos; tente de novo daqui a pouco.": {
    es: "Todavía no identificamos el pago. Pix se confirma en minutos; inténtalo de nuevo en un rato.",
  },
  "Não foi possível conferir o pagamento agora.": { es: "No fue posible verificar el pago ahora." },
  "O preço por mensagem do Broadcast ainda não foi definido para a sua empresa.": {
    es: "El precio por mensaje del Broadcast todavía no se definió para tu empresa.",
  },
  "Mensagem do Broadcast a {preco} no seu plano. Mensagem que falha não é cobrada.": {
    es: "Mensaje del Broadcast a {preco} en tu plan. El mensaje que falla no se cobra.",
  },
  Pacote: { es: "Paquete" },
  "cerca de {n} mensagens do Broadcast": { es: "cerca de {n} mensajes del Broadcast" },
  "Pix pelo Asaas. Entra na carteira quando o Asaas confirma; a nota sai pelo Asaas.": {
    es: "Pix por Asaas. Entra en la cartera cuando Asaas confirma; la factura sale por Asaas.",
  },
  "Gerar o Pix": { es: "Generar el Pix" },
  "Pix de {valor} gerado.": { es: "Pix de {valor} generado." },
  "Pix copiado.": { es: "Pix copiado." },
  "Não deu para copiar.": { es: "No se pudo copiar." },
  "Copiar o Pix": { es: "Copiar el Pix" },
  "{modulo} não está no plano da sua empresa": { es: "{modulo} no está en el plan de tu empresa" },
  "O que já foi feito aqui continua guardado e volta quando o módulo voltar.": {
    es: "Lo que ya se hizo aquí sigue guardado y vuelve cuando vuelva el módulo.",
  },
  "Ver os planos em Plano e cobrança": { es: "Ver los planes en Plan y facturación" },
  "Para usar, fale com quem administra a empresa.": {
    es: "Para usarlo, habla con quien administra la empresa.",
  },
  "sai em {data}": { es: "sale el {data}" },
  "ligado {origem}": { es: "activado {origem}" },
  "entra quando o ajuste for pago": { es: "entra cuando se pague el ajuste" },
  "no plano {plano}": { es: "en el plan {plano}" },
  "fora do plano": { es: "fuera del plan" },
  "Exige o módulo da instalação ligado.": { es: "Requiere el módulo de la instalación activado." },
  "Em todos os planos: atendimento com IA, CRM, agenda, follow-up, passagem para a equipe, leads da Meta, conversões, relatórios e o assistente. Desligar um módulo esconde a tela e para o envio; os dados ficam.":
    {
      es: "En todos los planes: atención con IA, CRM, agenda, seguimiento, traspaso al equipo, leads de Meta, conversiones, informes y el asistente. Desactivar un módulo oculta la pantalla y detiene el envío; los datos se quedan.",
    },
  "Preço por mensagem inválido.": { es: "Precio por mensaje inválido." },
  "Módulos do plano salvos.": { es: "Módulos del plan guardados." },
  "Módulos e Broadcast de cada plano": { es: "Módulos y Broadcast de cada plan" },
  "Ligar um módulo num plano liga para todas as empresas dele na hora. Tirar de um plano que alguém usa não vale: arquive e crie outro, como o preço.":
    {
      es: "Activar un módulo en un plan lo activa al instante para todas sus empresas. Quitarlo de un plan que alguien usa no vale: archívalo y crea otro, como el precio.",
    },
  "Vendas B2B está desligado em Recursos opcionais: o plano que o vende só o entrega com ele ligado.":
    {
      es: "Ventas B2B está desactivado en Recursos opcionales: el plan que lo vende solo lo entrega con él activado.",
    },
  "{n} empresa(s)": { es: "{n} empresa(s)" },
  "IA sem limite": { es: "IA sin límite" },
  "Mensagem do Broadcast (R$)": { es: "Mensaje del Broadcast (R$)" },
  "Frase do cartão na página de preços": { es: "Frase de la tarjeta en la página de precios" },
  'Selo "Mais escolhido"': { es: 'Sello "Más elegido"' },
  "Sem cobrança: não paga e não tem limites": { es: "Sin cobro: no paga y no tiene límites" },
  "Aviso de 3 dias antes em {data}": { es: "Aviso de 3 días antes el {data}" },
  "Fim do teste em {data}: aviso final": { es: "Fin de la prueba el {data}: aviso final" },
  "Fim do teste em {data}: 1ª fatura vence": {
    es: "Fin de la prueba el {data}: vence la 1.ª factura",
  },
  "Aviso final em {data} · suspensão em {suspensao}": {
    es: "Aviso final el {data} · suspensión el {suspensao}",
  },
  "Suspensão em {data}": { es: "Suspensión el {data}" },
  "Prazo até {data}; depois a régua volta": {
    es: "Plazo hasta el {data}; después vuelve el cobro",
  },
  "Lembrete semanal em {data}": { es: "Recordatorio semanal el {data}" },
  "Acesso até {data}, depois suspende": { es: "Acceso hasta el {data}, después se suspende" },
  "Próxima cobrança em {data}": { es: "Próximo cobro el {data}" },
  "Com prazo": { es: "Con plazo" },
  Suspensa: { es: "Suspendida" },
  Isenta: { es: "Exenta" },
  Suspensas: { es: "Suspendidas" },
  Canceladas: { es: "Canceladas" },
  Isentas: { es: "Exentas" },
  "Entrou; o teste começou": { es: "Entró; la prueba comenzó" },
  "Aviso: o teste termina em 3 dias": { es: "Aviso: la prueba termina en 3 días" },
  "1ª fatura vence": { es: "Vence la 1.ª factura" },
  "Fim do teste sem assinatura: aviso final": {
    es: "Fin de la prueba sin suscripción: aviso final",
  },
  "Suspensão, 48 horas depois do aviso final": {
    es: "Suspensión, 48 horas después del aviso final",
  },
  "Fim do período pago": { es: "Fin del período pagado" },
  "Próxima cobrança": { es: "Próximo cobro" },
  "Pagamento não identificado": { es: "Pago no identificado" },
  "Aviso final": { es: "Aviso final" },
  Suspensão: { es: "Suspensión" },
  "A compra de créditos por Pix não está ligada nesta instalação. Fale com a nossa equipe para recarregar.":
    {
      es: "La compra de créditos por Pix no está activada en esta instalación. Habla con nuestro equipo para recargar.",
    },
  "Sua empresa recebe créditos pela nossa equipe. Fale com a equipe para recarregar.": {
    es: "Tu empresa recibe créditos de nuestro equipo. Habla con el equipo para recargar.",
  },
  "Assine o plano em Plano e cobrança antes de comprar créditos: o Pix sai no mesmo cadastro do pagamento.":
    {
      es: "Suscríbete al plan en Plan y facturación antes de comprar créditos: el Pix sale en el mismo registro del pago.",
    },
  "A compra de créditos por Pix é só pelo Asaas. Fale com a nossa equipe para recarregar.": {
    es: "La compra de créditos por Pix es solo por Asaas. Habla con nuestro equipo para recargar.",
  },
  "A compra por Pix está indisponível agora. Tente de novo mais tarde ou fale com a nossa equipe.":
    {
      es: "La compra por Pix no está disponible ahora. Inténtalo más tarde o habla con nuestro equipo.",
    },
  "Ainda não há pacotes de crédito à venda.": {
    es: "Todavía no hay paquetes de crédito a la venta.",
  },
  // a lista do que vem em todos os planos (app/precos/page.tsx)
  "Agente de IA no WhatsApp, 24 horas por dia": { es: "Agente de IA en WhatsApp, las 24 horas" },
  "CRM com funis, contatos e tarefas": { es: "CRM con embudos, contactos y tareas" },
  "Agenda: o agente marca, remarca e confirma": {
    es: "Agenda: el agente agenda, reprograma y confirma",
  },
  "Follow-up com modelos por segmento": { es: "Seguimiento con modelos por segmento" },
  "Passagem para a equipe com a ficha do cliente": {
    es: "Traspaso al equipo con la ficha del cliente",
  },
  "Leads dos formulários da Meta e conversões": {
    es: "Leads de los formularios de Meta y conversiones",
  },
  "Relatórios, painéis e o assistente": { es: "Informes, paneles y el asistente" },

  // a campanha que a rotina pausou porque o módulo saiu do plano
  "O Broadcast não faz parte do plano atual da empresa. A lista e os números ficam guardados.": {
    es: "El Broadcast no forma parte del plan actual de la empresa. La lista y los números quedan guardados.",
  },
  "Pausada: o e-mail marketing não faz parte do plano atual da empresa. A lista e os números ficam guardados.": {
    es: "Pausada: el email marketing no forma parte del plan actual de la empresa. La lista y los números quedan guardados.",
  },
};
