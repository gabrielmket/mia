/**
 * FORK MIA (9011+): as frases de tela da agenda do Outlook / Microsoft 365
 * (docs/fork/agenda-microsoft.md), em espanhol.
 *
 * Arquivo à parte e espalhado no `DICIONARIO` do upstream com UMA linha: as
 * frases da MIA não se misturam com as dele, e a sincronização não conflita
 * entrada por entrada.
 */
export const DICIONARIO_DA_AGENDA_MICROSOFT: Record<string, { es: string }> = {
  // recursos opcionais
  "Outlook e Microsoft Teams": { es: "Outlook y Microsoft Teams" },
  "Cada pessoa conecta a própria agenda do Outlook na Agenda, e o Teams vira um local de atendimento.": {
    es: "Cada persona conecta su propia agenda de Outlook en la Agenda, y Teams pasa a ser un lugar de atención.",
  },
  "Cadastre o app da Microsoft na tela Microsoft 365.": { es: "Registra la app de Microsoft en la pantalla Microsoft 365." },

  // /admin/microsoft
  "Copiado.": { es: "Copiado." },
  "Não deu para copiar. Selecione o texto e copie.": { es: "No se pudo copiar. Selecciona el texto y cópialo." },
  "Microsoft 365 desta instalação": { es: "Microsoft 365 de esta instalación" },
  "Com estas informações, quem atende conecta a agenda do Outlook (conta de trabalho ou pessoal) e o Teams passa a ser um local de atendimento. Valem para a instalação inteira; cada pessoa conecta a conta dela depois.": {
    es: "Con estos datos, quien atiende conecta la agenda de Outlook (cuenta de trabajo o personal) y Teams pasa a ser un lugar de atención. Valen para toda la instalación; cada persona conecta su cuenta después.",
  },
  "Cole exatamente isto em Autenticação › URIs de redirecionamento, plataforma Web, no registro do aplicativo. Registre o endereço de cada domínio pelo qual a equipe abre o sistema.": {
    es: "Pega exactamente esto en Autenticación › URI de redirección, plataforma Web, en el registro de la aplicación. Registra la dirección de cada dominio por el que el equipo abre el sistema.",
  },
  "ID do aplicativo (cliente)": { es: "ID de la aplicación (cliente)" },
  "Valor do segredo do cliente": { es: "Valor del secreto de cliente" },
  "(já cadastrado)": { es: "(ya registrado)" },
  "Já existe um segredo cadastrado. Deixe em branco para mantê-lo, ou digite um novo para substituir.": {
    es: "Ya hay un secreto registrado. Déjalo en blanco para mantenerlo, o escribe uno nuevo para reemplazarlo.",
  },
  "Copie o Valor (não o ID do segredo). Ele é guardado cifrado e nunca volta a aparecer nesta tela.": {
    es: "Copia el Valor (no el ID del secreto). Se guarda cifrado y nunca vuelve a aparecer en esta pantalla.",
  },
  "O segredo vence em": { es: "El secreto vence el" },
  "O segredo venceu. Crie um novo no registro do aplicativo e cole aqui: sem ele nenhuma agenda do Outlook renova.": {
    es: "El secreto venció. Crea uno nuevo en el registro de la aplicación y pégalo aquí: sin él ninguna agenda de Outlook se renueva.",
  },
  "dias. Crie um novo antes disso.": { es: "días. Crea uno nuevo antes de eso." },
  "A Microsoft deixa o segredo durar no máximo 24 meses. Esta tela avisa 30 dias antes.": {
    es: "Microsoft deja que el secreto dure como máximo 24 meses. Esta pantalla avisa 30 días antes.",
  },
  "Quem pode conectar": { es: "Quién puede conectar" },
  "Qualquer empresa e contas pessoais": { es: "Cualquier empresa y cuentas personales" },
  "Só uma empresa (ID do locatário)": { es: "Solo una empresa (ID del inquilino)" },
  "ID do locatário": { es: "ID del inquilino" },
  "Link de aprovação para o TI de uma empresa": { es: "Enlace de aprobación para el equipo de TI de una empresa" },
  "Para a empresa que bloqueia aplicativos externos: o administrador de TI dela abre este link e aprova uma vez. Depois disso cada funcionário conecta sozinho.": {
    es: "Para la empresa que bloquea aplicaciones externas: su administrador de TI abre este enlace y aprueba una vez. Después cada empleado conecta por su cuenta.",
  },
  "As notificações de mudança chegam em": { es: "Las notificaciones de cambio llegan a" },
  "Não é preciso registrar este endereço; ele precisa ser HTTPS e público.": {
    es: "No hace falta registrar esta dirección; debe ser HTTPS y pública.",
  },
  "Esta instalação já tem as credenciais no arquivo de configuração do servidor. O que você salvar aqui passa a valer no lugar delas.": {
    es: "Esta instalación ya tiene las credenciales en el archivo de configuración del servidor. Lo que guardes aquí pasa a valer en su lugar.",
  },
  "Ao trocar o aplicativo:": { es: "Al cambiar la aplicación:" },
  "quem já conectou o Outlook vai precisar conectar de novo. Trocar só o segredo do MESMO aplicativo não derruba ninguém.": {
    es: "quien ya conectó Outlook tendrá que conectarlo de nuevo. Cambiar solo el secreto de la MISMA aplicación no desconecta a nadie.",
  },
  "Credenciais da Microsoft salvas.": { es: "Credenciales de Microsoft guardadas." },
  "Confira o ID do aplicativo e o segredo.": { es: "Revisa el ID de la aplicación y el secreto." },
  "A cifra não está disponível nesta instalação. O segredo não foi gravado.": {
    es: "El cifrado no está disponible en esta instalación. El secreto no se guardó.",
  },

  // Suas agendas
  "Suas agendas": { es: "Tus agendas" },
  "Escolha quais agendas ocupam seus horários e onde publicar os novos compromissos. Os já publicados continuam na agenda onde estão.": {
    es: "Elige qué agendas ocupan tus horarios y dónde publicar los nuevos compromisos. Los ya publicados siguen en la agenda donde están.",
  },
  "Com o destino no Google, estes tipos ficam sem link do Teams para você (o Teams só é criado em agenda do Outlook):": {
    es: "Con el destino en Google, estos tipos se quedan sin enlace de Teams para ti (Teams solo se crea en una agenda de Outlook):",
  },
  "Google · não conectado.": { es: "Google · no conectado." },
  Google: { es: "Google" },
  "Google Meet: atualize a lista para conferir": { es: "Google Meet: actualiza la lista para comprobarlo" },
  "Permite criar links do Google Meet": { es: "Permite crear enlaces de Google Meet" },
  "Esta agenda não permite criar Google Meet": { es: "Esta agenda no permite crear Google Meet" },
  "Outlook · não conectado. Conecte para escolher uma agenda do Outlook como destino.": {
    es: "Outlook · no conectado. Conéctalo para elegir una agenda de Outlook como destino.",
  },
  "Conectar Outlook": { es: "Conectar Outlook" },
  Outlook: { es: "Outlook" },
  "conta pessoal": { es: "cuenta personal" },
  "conta de trabalho": { es: "cuenta de trabajo" },
  "A conexão com o Outlook parou. Conecte de novo pela Agenda.": {
    es: "La conexión con Outlook se detuvo. Conéctalo de nuevo desde la Agenda.",
  },
  "Só leitura": { es: "Solo lectura" },
  "Permite Microsoft Teams": { es: "Permite Microsoft Teams" },
  "Esta agenda não permite Microsoft Teams": { es: "Esta agenda no permite Microsoft Teams" },
  "Tempo real ligado": { es: "Tiempo real activado" },
  "Um só destino entre Google e Outlook: marcar um desmarca o outro.": {
    es: "Un solo destino entre Google y Outlook: marcar uno desmarca el otro.",
  },
  "Atualizar lista": { es: "Actualizar lista" },
  "Alterações não salvas": { es: "Cambios sin guardar" },
  "Escolha agendas disponíveis das suas próprias contas.": { es: "Elige agendas disponibles de tus propias cuentas." },

  // Cartão do Outlook
  "Outlook · Microsoft 365": { es: "Outlook · Microsoft 365" },
  "Falta cadastrar o aplicativo da Microsoft desta instalação.": {
    es: "Falta registrar la aplicación de Microsoft de esta instalación.",
  },
  "Cadastrar as credenciais da Microsoft": { es: "Registrar las credenciales de Microsoft" },
  "Esta instalação ainda não tem a conexão com a Microsoft. Não é nada que você tenha feito.": {
    es: "Esta instalación todavía no tiene la conexión con Microsoft. No es nada que hayas hecho.",
  },
  "A conexão com o Outlook parou: a Microsoft pediu para entrar de novo.": {
    es: "La conexión con Outlook se detuvo: Microsoft pidió iniciar sesión de nuevo.",
  },
  "Enquanto isso, os compromissos continuam aqui; só não vão para o Outlook.": {
    es: "Mientras tanto, los compromisos siguen aquí; solo no van a Outlook.",
  },
  "Outlook conectado:": { es: "Outlook conectado:" },
  "Última sincronização: agora": { es: "Última sincronización: ahora" },
  "Última sincronização: há": { es: "Última sincronización: hace" },
  "Conecte sua agenda do Outlook para ver aqui o que já está marcado lá, e enviar para lá o que for marcado aqui. Serve conta de trabalho (Microsoft 365) e pessoal (outlook.com).": {
    es: "Conecta tu agenda de Outlook para ver aquí lo que ya está agendado allí, y enviar allí lo que se agende aquí. Sirve cuenta de trabajo (Microsoft 365) y personal (outlook.com).",
  },
  "Agenda do Outlook conectada.": { es: "Agenda de Outlook conectada." },
  "Os compromissos que já estão lá aparecem aqui como ocupado.": {
    es: "Los compromisos que ya están allí aparecen aquí como ocupado.",
  },
  "O TI aprovou o aplicativo.": { es: "TI aprobó la aplicación." },
  "Agora é só conectar o Outlook.": { es: "Ahora solo falta conectar Outlook." },
  "A empresa bloqueou a conexão com aplicativos externos. Peça ao TI para aprovar uma vez:": {
    es: "La empresa bloqueó la conexión con aplicaciones externas. Pide a TI que la apruebe una vez:",
  },
  "Não deu para copiar. Peça o link a quem administra o sistema.": {
    es: "No se pudo copiar. Pide el enlace a quien administra el sistema.",
  },
  "Copiar link para o TI": { es: "Copiar enlace para TI" },
  "Link copiado.": { es: "Enlace copiado." },
  "Esta instalação ainda não tem a conexão com a Microsoft configurada": {
    es: "Esta instalación todavía no tiene configurada la conexión con Microsoft",
  },
  "Fale com quem administra o sistema.": { es: "Habla con quien administra el sistema." },
  "Não consegui começar a conexão com o Outlook": { es: "No pude iniciar la conexión con Outlook" },
  "Conecte de novo pelo cartão do Outlook.": { es: "Conéctalo de nuevo desde la tarjeta de Outlook." },
  "A Microsoft devolveu uma resposta incompleta": { es: "Microsoft devolvió una respuesta incompleta" },
  "A Microsoft não confirmou a conexão": { es: "Microsoft no confirmó la conexión" },
  "Conecte de novo. Se continuar, fale com quem administra o sistema.": {
    es: "Conéctalo de nuevo. Si continúa, habla con quien administra el sistema.",
  },
  "Não consegui ler os dados da conta da Microsoft": { es: "No pude leer los datos de la cuenta de Microsoft" },
  "Conecte de novo e aceite todas as permissões pedidas.": {
    es: "Conéctalo de nuevo y acepta todos los permisos solicitados.",
  },
  "A Microsoft não liberou o acesso contínuo à agenda": { es: "Microsoft no liberó el acceso continuo a la agenda" },
  "A aprovação do TI não foi concluída": { es: "La aprobación de TI no se completó" },
  "Peça ao administrador de TI para abrir o link de novo e aprovar.": {
    es: "Pide al administrador de TI que abra el enlace de nuevo y apruebe.",
  },
  "Não consegui conectar sua agenda do Outlook": { es: "No pude conectar tu agenda de Outlook" },
  "Não há agenda do Outlook conectada para esta pessoa.": { es: "No hay agenda de Outlook conectada para esta persona." },

  // entrega 2: a publicação e os conflitos
  "Os compromissos que já estão no Outlook continuam lá e também serão publicados no Google.": {
    es: "Los compromisos que ya están en Outlook siguen allí y también se publicarán en Google.",
  },
  "Sincronização Outlook": { es: "Sincronización Outlook" },
  "O horário mudou nos dois lados. Este compromisso precisa de uma decisão.": {
    es: "El horario cambió en los dos lados. Este compromiso necesita una decisión.",
  },
  "Enviando a alteração para o Outlook.": { es: "Enviando el cambio a Outlook." },
  "Ainda não publicado no Outlook.": { es: "Todavía no publicado en Outlook." },
  "No Outlook": { es: "En Outlook" },
  "A publicação também substituiria campos alterados no Outlook. Revise antes de continuar.": {
    es: "La publicación también reemplazaría campos cambiados en Outlook. Revísalo antes de continuar.",
  },
  "Preservamos o histórico daqui. Revise o evento no Outlook ou crie outro compromisso pela Agenda.": {
    es: "Conservamos el historial de aquí. Revisa el evento en Outlook o crea otro compromiso desde la Agenda.",
  },
  "Usar cancelamento do Outlook": { es: "Usar la cancelación de Outlook" },
  "Usar horário do Outlook": { es: "Usar el horario de Outlook" },
  "Preservar campos do Outlook": { es: "Conservar los campos de Outlook" },
  "Decisão registrada. O Outlook será relido antes de aplicar; mudanças novas exigem outra decisão.": {
    es: "Decisión registrada. Outlook se volverá a leer antes de aplicar; los cambios nuevos exigen otra decisión.",
  },
  "Remarcar ou cancelar no Outlook volta para cá e fica registrado no negócio.": {
    es: "Reprogramar o cancelar en Outlook vuelve aquí y queda registrado en el negocio.",
  },

  // entrega 3: Microsoft Teams
  "Microsoft Teams": { es: "Microsoft Teams" },
  "O link do Teams é criado sozinho quando o compromisso vai para uma agenda do Outlook que permite Teams, e é enviado ao cliente pelo WhatsApp quando a IA marca. Quem atende este tipo precisa ter o Outlook como destino.": {
    es: "El enlace de Teams se crea solo cuando el compromiso va a una agenda de Outlook que permite Teams, y se envía al cliente por WhatsApp cuando la IA agenda. Quien atiende este tipo necesita tener Outlook como destino.",
  },
  "não tem o Outlook como destino. Os compromissos deste tipo com essa pessoa ficam sem link do Teams.": {
    es: "no tiene Outlook como destino. Los compromisos de este tipo con esa persona se quedan sin enlace de Teams.",
  },
  "Link enviado para a conversa autorizada.": { es: "Enlace enviado a la conversación autorizada." },
  "Criando link do Microsoft Teams": { es: "Creando el enlace de Microsoft Teams" },
  "Link do Microsoft Teams pronto": { es: "Enlace de Microsoft Teams listo" },
  "Não foi possível criar o link do Microsoft Teams": { es: "No fue posible crear el enlace de Microsoft Teams" },
  "O link fica pronto quando o compromisso chega ao Outlook. Até lá, nada é enviado ao cliente.": {
    es: "El enlace queda listo cuando el compromiso llega a Outlook. Hasta entonces, no se envía nada al cliente.",
  },
  "Link do Microsoft Teams:": { es: "Enlace de Microsoft Teams:" },
  "Esta agenda não permite Microsoft Teams. Confira a conta conectada ou escolha outro destino.": {
    es: "Esta agenda no permite Microsoft Teams. Revisa la cuenta conectada o elige otro destino.",
  },
  "O Teams só é criado em agenda do Outlook. Este compromisso foi para o Google.": {
    es: "Teams solo se crea en una agenda de Outlook. Este compromiso fue a Google.",
  },
  "O Teams só é criado em agenda do Outlook. Quem atende ainda não tem o Outlook como destino.": {
    es: "Teams solo se crea en una agenda de Outlook. Quien atiende todavía no tiene Outlook como destino.",
  },
  "A Microsoft não conseguiu criar a reunião. Tente sincronizar novamente.": {
    es: "Microsoft no pudo crear la reunión. Intenta sincronizar de nuevo.",
  },
  "O link ainda não foi confirmado pela Microsoft. Confira o evento no Outlook.": {
    es: "Microsoft todavía no confirmó el enlace. Revisa el evento en Outlook.",
  },
  "A Microsoft não devolveu um link do Teams válido. Confira o evento no Outlook.": {
    es: "Microsoft no devolvió un enlace de Teams válido. Revisa el evento en Outlook.",
  },
};
