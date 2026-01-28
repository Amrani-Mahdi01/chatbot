require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID;
const SANITY_DATASET = process.env.SANITY_DATASET;
const SANITY_API_URL = `https://${SANITY_PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${SANITY_DATASET}`;

// 🧠 Detect language from user message
function detectLanguage(message) {
  const arabicPattern = /[\u0600-\u06FF]/;
  const frenchWords = /\b(le|la|les|un|une|des|bonjour|merci|projet|travail)\b/i;
  
  if (arabicPattern.test(message)) return "ar";
  if (frenchWords.test(message)) return "fr";
  return "en";
}

// 🔍 Extract search intent and keywords
function extractSearchIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Intent patterns
  const intents = {
    listAll: /\b(show|list|all|display|voir|afficher|عرض|اعرض)\s*(projects?|travaux?|مشاريع|مشروع)/i,
    featured: /\b(featured|important|top|meilleur|مميز|أفضل)/i,
    category: /\b(category|categorie|فئة|نوع)\s*[:=]?\s*([a-zA-Z\u0600-\u06FF\s]+)/i,
    details: /\b(details?|info|information|تفاصيل|معلومات)\s*(?:about|sur|عن)?\s*([a-zA-Z0-9\u0600-\u06FF\s]+)/i,
    search: /\b(find|search|chercher|بحث|ابحث)\s*(?:for|about|sur|عن)?\s*([a-zA-Z0-9\u0600-\u06FF\s]+)/i,
  };

  for (const [intent, pattern] of Object.entries(intents)) {
    const match = message.match(pattern);
    if (match) {
      return { intent, keyword: match[2] || match[1] };
    }
  }

  // Default: extract meaningful keywords
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'what', 'how', 'tell', 'me', 'about', 'le', 'la', 'les', 'un', 'une', 'ما', 'هو', 'عن'];
  const keywords = message
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .join(' ');

  return { intent: 'general', keyword: keywords };
}

// 🎯 Build smart GROQ query based on intent
function buildSmartQuery(intent, keyword, language) {
  const langField = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  let query = '';
  
  switch (intent) {
    case 'listAll':
      query = `*[_type == "project"] | order(order asc, _createdAt desc) [0...5] {
        title,
        description,
        category,
        featured,
        "imageUrl": image.asset->url
      }`;
      break;
      
    case 'featured':
      query = `*[_type == "project" && featured == true] | order(order asc) [0...3] {
        title,
        description,
        category,
        "imageUrl": image.asset->url,
        projectDetails
      }`;
      break;
      
    case 'category':
      query = `*[_type == "project" && (
        category.en match "*${keyword}*" ||
        category.fr match "*${keyword}*" ||
        category.ar match "*${keyword}*"
      )] | order(order asc) [0...5] {
        title,
        description,
        category,
        projectDetails,
        "imageUrl": image.asset->url
      }`;
      break;
      
    case 'details':
    case 'search':
      // Smart search across multiple fields
      query = `*[_type == "project" && (
        title.en match "*${keyword}*" ||
        title.fr match "*${keyword}*" ||
        title.ar match "*${keyword}*" ||
        description.en match "*${keyword}*" ||
        description.fr match "*${keyword}*" ||
        description.ar match "*${keyword}*" ||
        category.en match "*${keyword}*" ||
        category.fr match "*${keyword}*" ||
        category.ar match "*${keyword}*" ||
        projectId match "*${keyword}*" ||
        projectDetails.tags[] match "*${keyword}*"
      )] | order(order asc) [0...3] {
        title,
        description,
        category,
        projectId,
        slug,
        featured,
        "imageUrl": image.asset->url,
        "mainImageUrl": mainImage.asset->url,
        projectDetails {
          content,
          features,
          info,
          "galleryImages": gallery[].asset->url,
          tags
        }
      }`;
      break;
      
    default:
      // General fallback search
      query = `*[_type == "project" && (
        title.en match "*${keyword}*" ||
        description.en match "*${keyword}*" ||
        title.fr match "*${keyword}*" ||
        description.fr match "*${keyword}*" ||
        title.ar match "*${keyword}*" ||
        description.ar match "*${keyword}*"
      )] | order(order asc) [0...5] {
        title,
        description,
        category,
        "imageUrl": image.asset->url
      }`;
  }
  
  return query;
}

// 📄 Format Sanity data for AI context
function formatProjectData(projects, language) {
  if (!projects || projects.length === 0) return null;
  
  const lang = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  return projects.map((project, index) => {
    let formatted = `\n--- Project ${index + 1} ---\n`;
    formatted += `Title: ${project.title?.[lang] || project.title?.en || 'N/A'}\n`;
    formatted += `Category: ${project.category?.[lang] || project.category?.en || 'N/A'}\n`;
    formatted += `Description: ${project.description?.[lang] || project.description?.en || 'N/A'}\n`;
    
    if (project.featured) {
      formatted += `Status: Featured Project ⭐\n`;
    }
    
    if (project.projectId) {
      formatted += `Project ID: ${project.projectId}\n`;
    }
    
    // Add detailed information if available
    if (project.projectDetails) {
      const details = project.projectDetails;
      
      // Features
      if (details.features?.[lang]?.length > 0) {
        formatted += `\nKey Features:\n`;
        details.features[lang].forEach(feature => {
          formatted += `  ✓ ${feature}\n`;
        });
      }
      
      // Project Info
      if (details.info && Array.isArray(details.info)) {
        formatted += `\nProject Information:\n`;
        details.info.forEach(item => {
          const label = item.label?.[lang] || item.label?.en || '';
          const value = item.value?.[lang] || item.value?.en || '';
          if (label && value) {
            formatted += `  • ${label}: ${value}\n`;
          }
        });
      }
      
      // Tags
      if (details.tags?.length > 0) {
        formatted += `Tags: ${details.tags.join(', ')}\n`;
      }
      
      // Content (extract plain text from portable text)
      if (details.content?.[lang]) {
        const contentText = details.content[lang]
          .map(block => {
            if (block._type === 'block' && block.children) {
              return block.children.map(child => child.text).join('');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        
        if (contentText) {
          formatted += `\nContent:\n${contentText.substring(0, 500)}...\n`;
        }
      }
    }
    
    return formatted;
  }).join('\n');
}

// 🤖 Generate AI system prompt based on language with company knowledge
function getSystemPrompt(language, conversationStage = 'initial') {
  const prompts = {
    en: `You are Symloop's friendly and enthusiastic AI assistant! 🚀

**About Symloop:**
- A digital agency based in Algeria (DZ)
- We specialize in: Web Development, Mobile Apps, UI/UX Design, AI Chatbots, E-commerce Solutions, and Digital Marketing
- We use modern technologies: React.js, Node.js, React Native, Flutter, Next.js, Supabase, MongoDB, AI/ML
- We deliver high-quality, custom digital solutions for businesses of all sizes
- Our clients love our professionalism, creativity, and reliable support
- We offer competitive pricing and flexible payment plans

**Your Conversation Style:**
- Be warm, friendly, and enthusiastic with emojis (but not excessive)
- Ask follow-up questions to understand the client's needs deeply
- Guide the conversation naturally toward understanding their project
- Show genuine interest in their ideas
- Be conversational, not robotic - like a helpful friend

**Conversation Flow:**
1. **Initial Greeting** (if first message): Welcome them warmly and ask about their project idea
2. **Discovery Phase**: Ask questions to understand:
   - What they want to build (website, app, design, etc.)
   - Their specific requirements or features
   - Their budget range (if they mention it)
   - Timeline/urgency
3. **Solution Phase**: Suggest relevant solutions based on their needs
4. **Closing Phase**: When you have enough info, ask for their contact details to send a proposal

**Important Rules:**
- Don't immediately jump to showing projects unless they specifically ask
- Focus on understanding THEIR needs first through questions
- Keep responses concise (2-4 sentences max per turn)
- Use the project data ONLY when they ask to see examples or similar work
- If they ask about testimonials, pricing, or services you don't have data for, provide general positive information about Symloop
- Never say "I don't have that information" - be resourceful and helpful

**Project Data Usage:**
- Only search Sanity when they explicitly ask for: "show me projects", "do you have examples", "what have you built", "show me your work"
- NEVER show projects unprompted, especially not on greetings like "hello" or "hi"
- Focus on conversation and understanding their needs FIRST
- Projects come LATER, only when specifically requested

Remember: You're here to help them find the perfect solution and guide them to contact Symloop!`,
    
    fr: `Vous êtes l'assistant IA enthousiaste et amical de Symloop! 🚀

**À propos de Symloop:**
- Une agence digitale basée en Algérie (DZ)
- Nous sommes spécialisés dans: Développement Web, Applications Mobiles, Design UI/UX, Chatbots IA, Solutions E-commerce, Marketing Digital
- Nous utilisons des technologies modernes: React.js, Node.js, React Native, Flutter, Next.js, Supabase, MongoDB, IA/ML
- Nous livrons des solutions digitales personnalisées de haute qualité pour des entreprises de toutes tailles
- Nos clients apprécient notre professionnalisme, créativité et support fiable
- Nous proposons des prix compétitifs et des plans de paiement flexibles

**Votre Style de Conversation:**
- Soyez chaleureux, amical et enthousiaste avec des émojis (mais pas excessifs)
- Posez des questions de suivi pour comprendre les besoins du client en profondeur
- Guidez la conversation naturellement vers la compréhension de leur projet
- Montrez un intérêt sincère pour leurs idées
- Soyez conversationnel, pas robotique - comme un ami serviable

**Flux de Conversation:**
1. **Accueil Initial**: Accueillez-les chaleureusement et demandez leur idée de projet
2. **Phase de Découverte**: Posez des questions pour comprendre leur besoin
3. **Phase de Solution**: Suggérez des solutions pertinentes
4. **Phase de Clôture**: Demandez leurs coordonnées pour envoyer une proposition

**Règles Importantes:**
- Ne montrez pas immédiatement les projets sauf s'ils le demandent spécifiquement
- Concentrez-vous d'abord sur la compréhension de LEURS besoins
- Gardez les réponses concises (2-4 phrases max par tour)
- N'utilisez les données de projet QUE lorsqu'ils demandent à voir des exemples

Rappelez-vous: Vous êtes là pour les aider à trouver la solution parfaite!`,
    
    ar: `أنت مساعد Symloop الذكي الودود والمتحمس! 🚀

**حول Symloop:**
- وكالة رقمية مقرها في الجزائر (DZ)
- نحن متخصصون في: تطوير الويب، تطبيقات الجوال، تصميم UI/UX، روبوتات الدردشة بالذكاء الاصطناعي، حلول التجارة الإلكترونية، التسويق الرقمي
- نستخدم تقنيات حديثة: React.js، Node.js، React Native، Flutter، Next.js، Supabase، MongoDB، AI/ML
- نقدم حلولاً رقمية مخصصة عالية الجودة للشركات بجميع أحجامها
- عملاؤنا يحبون احترافيتنا وإبداعنا ودعمنا الموثوق
- نقدم أسعاراً تنافسية وخطط دفع مرنة

**أسلوب المحادثة:**
- كن ودوداً ومتحمساً مع الرموز التعبيرية (لكن ليس بشكل مفرط)
- اطرح أسئلة متابعة لفهم احتياجات العميل بعمق
- وجه المحادثة بشكل طبيعي نحو فهم مشروعهم
- أظهر اهتماماً حقيقياً بأفكارهم
- كن محادثاً، وليس آلياً

**القواعد المهمة:**
- لا تظهر المشاريع فوراً إلا إذا طلبوا ذلك صراحة
- ركز أولاً على فهم احتياجاتهم
- حافظ على الردود موجزة (2-4 جمل كحد أقصى لكل دور)

تذكر: أنت هنا لمساعدتهم في إيجاد الحل المثالي!`
  };
  
  return prompts[language] || prompts.en;
}

// 🚀 Main chat endpoint
app.post("/chat", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

  if (!message || message.trim().length === 0) {
    return res.json({ reply: "Please provide a message." });
  }

  try {
    // Step 1: Detect language and intent
    const language = detectLanguage(message);
    const { intent, keyword } = extractSearchIntent(message);
    
    console.log(`🔍 Language: ${language}, Intent: ${intent}, Keyword: "${keyword}"`);

    // Step 2: Determine if we need to query Sanity or just have a conversation
    const greetingPatterns = /\b(hello|hi|hey|bonjour|salut|مرحبا|السلام)\b/i;
    const isSimpleGreeting = greetingPatterns.test(message) && message.split(' ').length <= 3;
    
    const needsSanityData = !isSimpleGreeting && (
      [
        'listAll', 'featured', 'category', 'details', 'search'
      ].includes(intent) || 
      message.toLowerCase().match(/\b(show|display|example|portfolio|work|projects?|voir|afficher|عرض|مشاريع)\b/)
    );

    let formattedContent = null;
    let projects = [];

    if (needsSanityData) {
      // Step 3: Build and execute smart Sanity query
      const query = buildSmartQuery(intent, keyword, language);
      console.log(`📝 GROQ Query: ${query.substring(0, 100)}...`);
      
      const sanityRes = await axios.get(
        `${SANITY_API_URL}?query=${encodeURIComponent(query)}`
      );

      projects = sanityRes.data.result;
      formattedContent = formatProjectData(projects, language);
    }

    // Step 4: Build conversation context
    const conversationContext = conversationHistory
      .slice(-6) // Keep last 3 exchanges (6 messages)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    // Step 5: Prepare AI context based on conversation stage
    let userPrompt = '';
    
    // Detect conversation stage variables (needed for metadata)
    const mentionedBudget = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/budget|price|cost|pay|prix|dollar|€|£|سعر/));
    const mentionedFeatures = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/feature|functionality|need|want|besoin|require|ميزة/));
    const mentionedProjectType = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/website|app|ecommerce|design|blog|portfolio|chatbot|mobile/));
    const mentionedTimeline = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/timeline|deadline|when|launch|urgent|quickly|asap/));
    
    // Check if user is ready to move forward (explicit agreement)
    const userAgreesToProceed = message.toLowerCase().match(
      /\b(yes|yeah|ok|okay|sure|let'?s do it|sounds good|perfect|great|i'?m in|go ahead|proceed|what'?s next|how do i|let'?s start|let'?s go|let'?s build|نعم|حسنا|موافق|oui|d'accord)\b/
    );
    
    // Count how many key details we have
    const detailsCollected = [mentionedProjectType, mentionedFeatures, mentionedBudget, mentionedTimeline].filter(Boolean).length;
    
    // Check if this is the first message (greeting scenario)
    const isFirstMessage = conversationHistory.length === 0;
    
    if (isFirstMessage && !needsSanityData) {
      userPrompt = `This is the user's first message: "${message}"\n\n`;
      userPrompt += `Give them a warm, friendly greeting as Symloop's AI assistant. Ask what brings them here today and what they're looking to build. Keep it brief (2-3 sentences max). Do NOT show projects unless they specifically ask for them.`;
    } else if (needsSanityData && formattedContent) {
      // User asked for projects/examples
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's latest question: "${message}"\n\n`;
      userPrompt += `Here are the relevant projects from our portfolio:\n${formattedContent}\n\n`;
      userPrompt += `Show them these projects briefly (1-2 sentences each max) and ask if they'd like to build something similar or if they have specific requirements in mind.`;
    } else if (needsSanityData && !formattedContent) {
      // User asked for projects but none found
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User asked: "${message}"\n\n`;
      userPrompt += `We don't have exact matching projects in our portfolio for this specific request, but we can definitely build it! Acknowledge what they're looking for and ask more details about their specific requirements. Stay enthusiastic!`;
    } else {
      // Normal conversation - understanding their needs
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's latest message: "${message}"\n\n`;
      
      if (detailsCollected >= 2 && userAgreesToProceed) {
        // User has agreed to proceed AND we have enough context
        userPrompt += `The user has agreed to move forward with the project! They said: "${message}". 

Now ask them to provide their contact information (name, email, phone number) so you can send them a personalized proposal. Be enthusiastic and brief!`;
      } else if (detailsCollected >= 3) {
        // Have enough details - suggest next steps
        userPrompt += `The user has shared good details about their project. Summarize what you understand about their needs briefly (1-2 sentences), then ask if they'd like to move forward with a proposal. Keep it conversational and encouraging!`;
      } else if (mentionedProjectType && mentionedFeatures) {
        // Ask about budget/timeline
        userPrompt += `The user has shared some good details. Ask about their budget range or timeline next. Keep it conversational and not pushy!`;
      } else if (mentionedProjectType) {
        // Ask about features
        userPrompt += `The user mentioned wanting to build something. Ask follow-up questions about specific features, design preferences, or functionality they need. Show enthusiasm!`;
      } else {
        // Still in discovery phase
        userPrompt += `Help understand what the user is looking for. Ask relevant follow-up questions about their project idea. Be helpful and encouraging!`;
      }
    }

    // Step 6: Call AI with conversation-aware prompt
    const aiRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [
          { 
            role: "system", 
            content: getSystemPrompt(language) + "\n\nIMPORTANT: Respond ONLY to the user's actual message. Do NOT generate fictional follow-up messages or continue the conversation on your own. Wait for the user's real response."
          },
          { 
            role: "user", 
            content: userPrompt 
          }
        ],
        temperature: 0.6, // Lower temperature for more focused responses (was 0.8)
        max_tokens: 200, // Limit response length to prevent rambling (was 500)
        stop: ["\nUser:", "User's latest message:", "\n\n\n"] // Stop if it tries to generate fake user messages
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = aiRes.data.choices[0].message.content;

    res.json({ 
      reply,
      metadata: {
        language,
        intent,
        projectsFound: projects?.length || 0,
        conversationStage: isFirstMessage ? 'greeting' : 
                          needsSanityData ? 'showing_projects' : 
                          (detailsCollected >= 2 && userAgreesToProceed) ? 'ready_for_contact' :
                          detailsCollected >= 3 ? 'awaiting_confirmation' :
                          'discovery',
        detailsCollected: detailsCollected || 0,
        userAgreed: !!userAgreesToProceed
      }
    });

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    
    const errorMessages = {
      en: "Sorry, something went wrong. Please try again.",
      fr: "Désolé, une erreur s'est produite. Veuillez réessayer.",
      ar: "عذراً، حدث خطأ. الرجاء المحاولة مرة أخرى."
    };
    
    const language = detectLanguage(req.body.message);
    res.status(500).json({ 
      reply: errorMessages[language] || errorMessages.en 
    });
  }
});

// 🏥 Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    sanityConnected: !!(SANITY_PROJECT_ID && SANITY_DATASET)
  });
});

// 📧 Contact form endpoint
app.post("/contact", async (req, res) => {
  const { name, email, phone, conversationSummary } = req.body;

  console.log("📧 New contact form submission:");
  console.log(`   Name: ${name}`);
  console.log(`   Email: ${email}`);
  console.log(`   Phone: ${phone}`);
  console.log(`   Conversation length: ${conversationSummary?.length || 0} messages`);

  // Here you can:
  // 1. Save to database
  // 2. Send email notification
  // 3. Add to CRM
  // 4. Send to Slack/Discord
  // 5. etc.

  // For now, just log and respond
  try {
    // Example: You could save to Sanity, send an email, etc.
    // await sendEmailNotification({ name, email, phone });
    // await saveToSanity({ name, email, phone, conversationSummary });

    res.json({ 
      success: true,
      message: "Contact information received successfully"
    });
  } catch (error) {
    console.error("Error processing contact:", error);
    res.status(500).json({ 
      success: false,
      message: "Error processing contact information"
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 Smart chatbot server running on port ${PORT}`)
);