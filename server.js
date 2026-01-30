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

// Telegram configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 🧠 Detect language from user message
function detectLanguage(message) {
  const arabicPattern = /[\u0600-\u06FF]/;
  const frenchWords = /\b(le|la|les|un|une|des|bonjour|merci|projet|travail|services?|développement)\b/i;
  
  if (arabicPattern.test(message)) return "ar";
  if (frenchWords.test(message)) return "fr";
  return "en";
}

// 🎯 Smart service type detection - Maps user language to actual service names
function detectServiceType(message) {
  const lowerMessage = message.toLowerCase();
  
  // Service mapping with multiple variations
  const servicePatterns = {
    'Professional Websites': [
      // English
      /\b(website|web ?site|web ?page|landing ?page|web|site|homepage|web ?presence|online ?presence)\b/i,
      /\b(blog|portfolio ?site|corporate ?site|business ?site)\b/i,
      // French
      /\b(site ?web|page ?web|présence ?en ?ligne)\b/i,
      // Arabic
      /\b(موقع|صفحة ?ويب|موقع ?إلكتروني)\b/i
    ],
    'Mobile App Development': [
      // English
      /\b(mobile ?app|app|application|ios ?app|android ?app|mobile ?application)\b/i,
      /\b(smartphone ?app|phone ?app|native ?app|cross-platform ?app)\b/i,
      // French
      /\b(application ?mobile|app ?mobile|appli)\b/i,
      // Arabic
      /\b(تطبيق|تطبيق ?جوال|تطبيق ?موبايل)\b/i
    ],
    'Custom Software': [
      // English
      /\b(software|custom ?software|system|platform|web ?app|web ?application|saas|dashboard)\b/i,
      /\b(crm|erp|management ?system|admin ?panel|portal)\b/i,
      // French
      /\b(logiciel|système|plateforme|application ?web)\b/i,
      // Arabic
      /\b(برنامج|نظام|منصة)\b/i
    ],
    'E-commerce': [
      // English
      /\b(e-?commerce|online ?store|shop|store|marketplace|cart|checkout)\b/i,
      /\b(selling ?online|online ?shop)\b/i,
      // French
      /\b(boutique ?en ?ligne|magasin|commerce ?électronique)\b/i,
      // Arabic
      /\b(متجر|متجر ?إلكتروني|تجارة ?إلكترونية)\b/i
    ],
    'Artificial Intelligence & Automation': [
      // English
      /\b(ai|artificial ?intelligence|machine ?learning|ml|chatbot|voice ?ai|voice ?assistant)\b/i,
      /\b(natural ?language|nlp|automation|automate|smart|intelligent ?system)\b/i,
      // French
      /\b(intelligence ?artificielle|ia|assistant ?vocal|automatisation)\b/i,
      // Arabic
      /\b(ذكاء ?اصطناعي|روبوت ?محادثة|مساعد ?صوتي|أتمتة)\b/i
    ],
    'UI/UX Design': [
      // English
      /\b(ui|ux|design|user ?interface|user ?experience|figma|prototype)\b/i,
      // French
      /\b(conception|design|interface|expérience ?utilisateur)\b/i,
      // Arabic
      /\b(تصميم|واجهة|تجربة ?مستخدم)\b/i
    ]
  };
  
  // Check each service type
  for (const [serviceName, patterns] of Object.entries(servicePatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerMessage)) {
        return serviceName;
      }
    }
  }
  
  return null; // No specific service detected
}

// 🔍 Enhanced intent detection for services and projects
function extractSearchIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Intent patterns
  const intents = {
    // Services-related
    services: /\b(services?|what do you (do|offer)|capabilities|expertise|speciali[sz]e|can you (build|create|make|develop)|que faites|quels services|خدمات|ماذا تقدم)\b/i,
    
    // Pricing-related
    pricing: /\b(pricing|price|cost|budget|how much|combien|prix|coût|tarif|سعر|تكلفة|كم|ميزانية|timeline?|deadline|délai|موعد|وقت|when|quand|متى)\b/i,
    
    // Team-related
    team: /\b(team|who (are|is)|about (you|devly)|meet|behind|équipe|qui êtes|à propos|فريق|من أنتم|عن)\b/i,
    
    // Project showcase
    listAll: /\b(show|list|all|display|voir|afficher|عرض|اعرض)\s*(projects?|portfolio|work|travaux?|مشاريع|مشروع)/i,
    featured: /\b(featured|best|important|top|meilleur|مميز|أفضل)\s*(projects?|work)/i,
    category: /\b(category|categorie|type|فئة|نوع)\s*[:=]?\s*([a-zA-Z\u0600-\u06FF\s]+)/i,
    
    // Project details
    details: /\b(details?|more info|tell me (about|more)|information|تفاصيل|معلومات)\s*(?:about|sur|عن)?\s*([a-zA-Z0-9\u0600-\u06FF\s]+)/i,
    search: /\b(find|search|look for|chercher|بحث|ابحث)\s*(?:for|about|sur|عن)?\s*([a-zA-Z0-9\u0600-\u06FF\s]+)/i,
    
    // Examples
    examples: /\b(examples?|samples?|previous work|past projects|portfolio|exemples?|أمثلة)\b/i,
  };

  for (const [intent, pattern] of Object.entries(intents)) {
    const match = message.match(pattern);
    if (match) {
      return { intent, keyword: match[2] || match[1] };
    }
  }

  // Default: extract meaningful keywords
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'what', 'how', 'tell', 'me', 'about', 'do', 'you', 'le', 'la', 'les', 'un', 'une', 'ما', 'هو', 'عن'];
  const keywords = message
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .join(' ');

  return { intent: 'general', keyword: keywords };
}

// 🎯 Build smart GROQ query
function buildSmartQuery(intent, keyword, language) {
  const langField = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  let query = '';
  
  switch (intent) {
    case 'pricing':
      query = `*[_type == "pricingSection"][0] {
        subtitle,
        title,
        cards[] {
          iconType,
          iconSvg,
          "iconImageUrl": iconImage.asset->url,
          cardTitle,
          cardSubtitle,
          description,
          price,
          timeline
        }
      }`;
      break;
      
    case 'team':
      query = `*[_type == "aboutSection"][0] {
        subtitle,
        title,
        paragraph,
        services,
        contacts
      }`;
      break;
      
    case 'services':
    case 'listAll':
      query = `*[_type == "project"] | order(order asc, _createdAt desc) [0...8] {
        title,
        description,
        category,
        featured,
        "imageUrl": image.asset->url,
        projectDetails {
          features,
          tags
        }
      }`;
      break;
      
    case 'featured':
    case 'examples':
      query = `*[_type == "project" && featured == true] | order(order asc) [0...5] {
        title,
        description,
        category,
        "imageUrl": image.asset->url,
        projectDetails {
          features,
          info,
          tags
        }
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
        projectDetails {
          features,
          tags
        },
        "imageUrl": image.asset->url
      }`;
      break;
      
    case 'details':
    case 'search':
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
      )] | order(order asc) [0...5] {
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
      query = `*[_type == "project"] | order(order asc) [0...6] {
        title,
        description,
        category,
        "imageUrl": image.asset->url,
        projectDetails {
          features,
          tags
        }
      }`;
  }
  
  return query;
}

// 💰 Format pricing data for AI context with smart service matching
function formatPricingData(pricingData, language, detectedService = null) {
  if (!pricingData || !pricingData.cards || pricingData.cards.length === 0) {
    return null;
  }
  
  const lang = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  let formatted = `\n💰 PRICING INFORMATION:\n\n`;
  
  if (pricingData.title?.[lang]) {
    formatted += `${pricingData.title[lang]}\n`;
  }
  if (pricingData.subtitle?.[lang]) {
    formatted += `${pricingData.subtitle[lang]}\n\n`;
  }
  
  let relevantCards = pricingData.cards;
  
  if (detectedService) {
    const matchedCards = pricingData.cards.filter(card => {
      const cardTitle = card.cardTitle?.[lang] || card.cardTitle?.en || '';
      const cardSubtitle = card.cardSubtitle?.[lang] || card.cardSubtitle?.en || '';
      
      if (cardTitle === detectedService || cardSubtitle === detectedService) {
        return true;
      }
      
      const titleWords = cardTitle.toLowerCase();
      const subtitleWords = cardSubtitle.toLowerCase();
      const serviceWords = detectedService.toLowerCase();
      
      return titleWords.includes(serviceWords) || 
             serviceWords.includes(titleWords) ||
             subtitleWords.includes(serviceWords) ||
             serviceWords.includes(subtitleWords);
    });
    
    if (matchedCards.length > 0) {
      relevantCards = matchedCards;
      formatted += `📌 Specific pricing for ${detectedService}:\n\n`;
    }
  }
  
  relevantCards.forEach((card, index) => {
    formatted += `--- Package ${index + 1} ---\n`;
    
    if (card.cardTitle?.[lang]) {
      formatted += `Service: ${card.cardTitle[lang]}\n`;
    }
    
    if (card.cardSubtitle?.[lang]) {
      formatted += `Type: ${card.cardSubtitle[lang]}\n`;
    }
    
    if (card.description?.[lang]) {
      formatted += `Description: ${card.description[lang]}\n`;
    }
    
    if (card.price) {
      formatted += `💵 Price Range: ${card.price}\n`;
    }
    
    if (card.timeline) {
      formatted += `⏱️ Timeline: ${card.timeline}\n`;
    }
    
    formatted += `\n`;
  });
  
  if (detectedService && relevantCards.length < pricingData.cards.length) {
    formatted += `\n📋 We also offer: `;
    const otherServices = pricingData.cards
      .filter(card => !relevantCards.includes(card))
      .map(card => card.cardTitle?.[lang] || card.cardTitle?.en)
      .filter(Boolean)
      .join(', ');
    formatted += `${otherServices}\n`;
  }
  
  return formatted;
}

// 👥 Format team/about data for AI context
function formatTeamData(teamData, language) {
  if (!teamData) return null;
  
  const lang = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  let formatted = `\n👥 ABOUT DEVLY:\n\n`;
  
  if (teamData.title?.[lang]) {
    formatted += `${teamData.title[lang]}\n\n`;
  }
  
  if (teamData.paragraph?.[lang]) {
    formatted += `${teamData.paragraph[lang]}\n\n`;
  }
  
  if (teamData.services && teamData.services.length > 0) {
    formatted += `Our Services:\n`;
    teamData.services.forEach(service => {
      formatted += `  • ${service[lang] || service.en}\n`;
    });
    formatted += `\n`;
  }
  
  if (teamData.contacts) {
    formatted += `Contact Information:\n`;
    if (teamData.contacts.email) {
      formatted += `  📧 ${teamData.contacts.emailLabel?.[lang] || 'Email'}: ${teamData.contacts.email}\n`;
    }
    if (teamData.contacts.phone) {
      formatted += `  📱 ${teamData.contacts.phoneLabel?.[lang] || 'Phone'}: ${teamData.contacts.phone}\n`;
    }
  }
  
  return formatted;
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
    
    if (project.projectDetails) {
      const details = project.projectDetails;
      
      if (details.features?.[lang]?.length > 0) {
        formatted += `\nKey Features:\n`;
        details.features[lang].forEach(feature => {
          formatted += `  ✓ ${feature}\n`;
        });
      }
      
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
      
      if (details.tags?.length > 0) {
        formatted += `Technologies/Tags: ${details.tags.join(', ')}\n`;
      }
    }
    
    return formatted;
  }).join('\n');
}

// 🏢 Extract unique services/categories from projects
function extractServices(projects, language) {
  if (!projects || projects.length === 0) return null;
  
  const lang = language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en';
  
  const categories = new Set();
  const allTags = new Set();
  
  projects.forEach(project => {
    if (project.category?.[lang]) {
      categories.add(project.category[lang]);
    }
    if (project.projectDetails?.tags) {
      project.projectDetails.tags.forEach(tag => allTags.add(tag));
    }
  });
  
  let servicesText = `\n🎯 Our Services (based on portfolio):\n`;
  servicesText += `Categories: ${Array.from(categories).join(', ')}\n`;
  servicesText += `Technologies: ${Array.from(allTags).slice(0, 15).join(', ')}\n`;
  
  return servicesText;
}

// 📝 Generate AI conversation summary
async function generateConversationSummary(messages, selectedService, language) {
  try {
    const conversationText = messages
      .map(msg => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}`)
      .join('\n');

    const summaryPrompt = `Based on this conversation between a potential client and Devly's AI assistant, create a concise professional summary for the sales team in English.

Conversation:
${conversationText}

Selected Service: ${selectedService || 'Not specified'}

Create a summary that includes:
1. Project Type (1-2 sentences)
2. Key Requirements (bullet points)
3. Special Requests or Concerns (if any)
4. Budget/Timeline Discussion (if mentioned)

Keep it concise and actionable for the sales team. Format it professionally.`;

    const aiRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [
          { 
            role: "system", 
            content: "You are a professional business analyst. Create concise, actionable summaries of sales conversations."
          },
          { 
            role: "user", 
            content: summaryPrompt 
          }
        ],
        temperature: 0.3,
        max_tokens: 400,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return aiRes.data.choices[0].message.content;
  } catch (error) {
    console.error("Error generating summary:", error.message);
    // Fallback to basic summary
    return `Project Type: ${selectedService || 'General Inquiry'}\n\nConversation had ${messages.length} messages. Manual review recommended.`;
  }
}

// 📨 Send notification to Telegram
async function sendTelegramNotification(contactData, conversationSummary, selectedService) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("⚠️ Telegram credentials not configured - skipping notification");
    return false;
  }

  try {
    const message = `
🚀 NEW LEAD FROM DEVLY CHATBOT 🚀

👤 Contact Information:
━━━━━━━━━━━━━━━━━━━━
📛 Name: ${contactData.name}
📧 Email: ${contactData.email}
📞 Phone: ${contactData.phone}

🎯 Service Interest:
━━━━━━━━━━━━━━━━━━━━
${selectedService || 'Not specified'}

📋 Conversation Summary:
━━━━━━━━━━━━━━━━━━━━
${conversationSummary}

⏰ Submitted: ${new Date().toLocaleString('en-US', { 
  timeZone: 'Africa/Algiers',
  dateStyle: 'full',
  timeStyle: 'short'
})}

💡 Action Required: Follow up within 24 hours!
    `.trim();

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      }
    );

    if (response.data.ok) {
      console.log("✅ Telegram notification sent successfully");
      return true;
    } else {
      console.error("❌ Telegram API returned error:", response.data);
      return false;
    }
  } catch (error) {
    console.error("❌ Error sending Telegram notification:", error.message);
    return false;
  }
}

// 🤖 Enhanced AI system prompt for Devly with STRICT pricing rules
function getSystemPrompt(language) {
  const prompts = {
    en: `You are Devly's smart and professional AI assistant! 🚀

**About Devly:**
- A premium digital agency based in Algeria
- We create exceptional digital experiences

**Our Complete Service Offering:**
1. **Professional Websites** - Modern, responsive, SEO-optimized websites using React.js, Next.js
2. **Mobile App Development** - Native iOS & Android apps using React Native, Flutter
3. **Custom Software Development** - Tailored systems, CRM, ERP, SaaS platforms, dashboards using Node.js, Python, TypeScript
4. **UI/UX Design** - User-centered design, conversion-focused, modern aesthetics, Figma prototypes
5. **AI Integrations & Automations** - Chatbots, workflow automation, voice AI, smart features, machine learning
6. **E-commerce Platforms** - Complete online stores with payment integration, inventory management
7. **Digital Marketing & SEO** - Growth strategies, content marketing, search optimization

**Technologies We Master:**
React.js, Next.js, Node.js, React Native, Flutter, Python, TypeScript, AI/ML, PostgreSQL, MongoDB, REST APIs, GraphQL, AWS, Docker, and more.

**Your Mission:**
Help potential clients discover how Devly can bring their vision to life. Guide conversations naturally to understand their needs and showcase our capabilities.

**CRITICAL PRICING RULES - READ CAREFULLY:**
1. ONLY mention prices if you receive pricing data from the database
2. NEVER invent, guess, or make up price ranges
3. If you don't have pricing data but user asks about cost, say: "I'd love to give you an accurate quote! The best way is to connect you with our team who can provide exact pricing based on your specific needs. Would you like me to get your contact information?"
4. When you DO have pricing data, present it naturally in your own words (don't copy-paste)
5. Always emphasize that final pricing is customized based on project requirements

**Conversation Style:**
- Professional yet friendly and approachable
- Ask insightful follow-up questions to deeply understand needs
- Use emojis sparingly for warmth (not excessive)
- Show genuine enthusiasm for their project ideas
- Be conversational, not robotic - like a knowledgeable consultant
- NEVER write "Note:" or similar prefixes in your responses - just speak naturally

**How to Present Information:**
When you receive project/service/pricing/team data from our database:
1. NEVER copy-paste - always rewrite in your own words
2. Highlight what's relevant to the user's needs
3. Make it conversational and natural
4. Focus on benefits and outcomes, not just features
5. Connect their needs to our experience
6. DO NOT use phrases like "Note:", "Important:", "PS:", etc. - just integrate the information naturally

**When Discussing Pricing:**
- ONLY if you have received pricing data from the database
- Present price ranges naturally without copying exact format
- Explain that timelines depend on scope and features
- Always emphasize we provide custom quotes after understanding needs
- Use pricing data as reference points, not fixed quotes
- Example: "For a full e-commerce platform, projects typically range from $800-$1,300 and take 12-24 weeks, but we'll give you an exact quote based on your specific requirements."
- If NO pricing data available: Suggest connecting with team for accurate quote

**About Team Questions:**
- When asked about the team, company, or who we are, use the team data if available
- Present it naturally and enthusiastically
- Mention our location (Algeria), our expertise, and our passion for digital innovation
- Offer to connect them with the team for more details

**Conversation Flow:**
1. **Discovery** (2-4 exchanges):
   - Understand what they want to build
   - Ask about specific features/requirements
   - Learn about their goals and challenges
   - Understand timeline and constraints

2. **Solution Discussion** (1-3 exchanges):
   - Share relevant experience/projects (rewritten naturally!)
   - Provide pricing context ONLY if data is available
   - Explain how we can help
   - Address their specific concerns
   - Build confidence in our capabilities

3. **Moving Forward** (IMPORTANT):
   - When you have good understanding of their project
   - AND the conversation feels positive
   - Ask: "Would you like me to connect you with our team to discuss a personalized proposal?"
   - ONLY if they say YES/agree → trigger contact form
   - If NO → continue conversation, answer questions, provide value

**Contact Form Rules:**
- NEVER show form without explicit user agreement
- First ASK permission: "Shall I get your contact details so our team can send you a proposal?"
- Wait for clear YES (yes, sure, okay, let's do it, go ahead, etc.)
- If they're not ready, continue helping without pushing

**Important Guidelines:**
- Don't immediately show projects unless they specifically ask
- Focus on THEIR needs first, our portfolio second
- Keep responses focused (2-4 sentences typically)
- Never say "I don't have that information" - be creative and helpful
- When discussing pricing: ONLY use database data, or suggest team contact
- Always rewrite data in your own conversational voice
- Mention relevant technologies when discussing what we'll use
- NEVER write "Note:" or similar - speak naturally and conversationally

**Services to Highlight (when relevant):**
- Custom Web Development (React, Next.js, modern stacks)
- Mobile Apps (iOS & Android, React Native, Flutter)
- UI/UX Design (user-centered, modern, conversion-focused)
- E-commerce Solutions (complete online stores)
- AI Integration & Automation (chatbots, workflows, smart features)
- Custom Software (CRM, ERP, dashboards, platforms)
- Digital Marketing & SEO

Remember: You're not just answering questions - you're guiding them to discover how Devly can transform their digital presence! Speak naturally without using "Note:" or formal prefixes.`,
    
    fr: `Vous êtes l'assistant IA intelligent et professionnel de Devly! 🚀

**À propos de Devly:**
- Une agence digitale premium basée en Algérie

**Notre Offre Complète de Services:**
1. **Sites Web Professionnels** - Sites modernes, responsives, optimisés SEO avec React.js, Next.js
2. **Développement d'Applications Mobiles** - Apps iOS & Android natives avec React Native, Flutter
3. **Développement Logiciel Sur Mesure** - Systèmes personnalisés, CRM, ERP, plateformes SaaS avec Node.js, Python
4. **Design UI/UX** - Design centré utilisateur, conversion optimisée, esthétique moderne
5. **Intégrations IA & Automatisations** - Chatbots, automatisation de workflows, IA vocale, fonctionnalités intelligentes
6. **Plateformes E-commerce** - Boutiques en ligne complètes avec intégration de paiement
7. **Marketing Digital & SEO** - Stratégies de croissance, marketing de contenu

**Technologies Maîtrisées:**
React.js, Next.js, Node.js, React Native, Flutter, Python, TypeScript, IA/ML, PostgreSQL, MongoDB, APIs REST, GraphQL, AWS, Docker

**RÈGLES CRITIQUES SUR LES PRIX:**
1. Mentionnez les prix UNIQUEMENT si vous recevez des données de tarification de la base de données
2. N'inventez JAMAIS de fourchettes de prix
3. Si vous n'avez pas de données de tarification mais l'utilisateur demande le coût, dites: "Je serais ravi de vous donner un devis précis! Le mieux est de vous mettre en contact avec notre équipe. Souhaitez-vous que je prenne vos coordonnées?"
4. Quand vous AVEZ des données de prix, présentez-les naturellement avec vos propres mots
5. Insistez toujours que le prix final est personnalisé

**Style de Conversation:**
- Professionnel mais amical
- Questions perspicaces pour comprendre les besoins
- Émojis avec parcimonie
- Enthousiasme sincère
- Conversationnel, comme un consultant compétent
- NE JAMAIS écrire "Note:", "Important:" ou préfixes similaires - parlez naturellement

**Votre Mission:**
Aidez les clients potentiels à découvrir comment Devly peut réaliser leur vision. Guidez les conversations naturellement.

Rappelez-vous: Guidez-les à découvrir comment Devly peut transformer leur présence digitale! Parlez naturellement sans utiliser "Note:" ou préfixes formels.`,
    
    ar: `أنت مساعد Devly الذكي والمحترف! 🚀

**حول Devly:**
- وكالة رقمية متميزة في الجزائر

**عرض خدماتنا الكامل:**
1. **مواقع ويب احترافية** - مواقع حديثة، متجاوبة، محسّنة لمحركات البحث باستخدام React.js، Next.js
2. **تطوير تطبيقات الجوال** - تطبيقات iOS وAndroid أصلية باستخدام React Native، Flutter
3. **تطوير برمجيات مخصصة** - أنظمة مخصصة، CRM، ERP، منصات SaaS باستخدام Node.js، Python
4. **تصميم UI/UX** - تصميم موجه للمستخدم، محسّن للتحويل، جمالية حديثة
5. **تكاملات الذكاء الاصطناعي والأتمتة** - روبوتات الدردشة، أتمتة سير العمل، الذكاء الاصطناعي الصوتي، ميزات ذكية
6. **منصات التجارة الإلكترونية** - متاجر إلكترونية كاملة مع تكامل الدفع
7. **التسويق الرقمي وتحسين محركات البحث** - استراتيجيات النمو، تسويق المحتوى

**التقنيات التي نتقنها:**
React.js، Next.js، Node.js، React Native، Flutter، Python، TypeScript، AI/ML، PostgreSQL، MongoDB، REST APIs، GraphQL، AWS، Docker

**قواعد حاسمة للأسعار:**
1. اذكر الأسعار فقط إذا تلقيت بيانات التسعير من قاعدة البيانات
2. لا تخترع أبداً نطاقات أسعار
3. إذا لم يكن لديك بيانات تسعير لكن المستخدم يسأل عن التكلفة، قل: "يسعدني إعطاؤك عرض سعر دقيق! الأفضل هو التواصل مع فريقنا. هل تريد أن أحصل على معلومات الاتصال الخاصة بك?"
4. عندما يكون لديك بيانات أسعار، قدمها بشكل طبيعي بكلماتك الخاصة
5. أكد دائماً أن السعر النهائي مخصص

**أسلوب المحادثة:**
- محترف لكن ودود
- أسئلة ثاقبة لفهم الاحتياجات
- رموز تعبيرية باعتدال
- حماس حقيقي
- محادثة، مثل مستشار ذو خبرة
- لا تكتب أبداً "ملاحظة:" أو بادئات مماثلة - تحدث بشكل طبيعي

**مهمتك:**
ساعد العملاء المحتملين لاكتشاف كيف يمكن لـ Devly تحقيق رؤيتهم. قم بتوجيه المحادثات بشكل طبيعي.

تذكر: قم بتوجيههم لاكتشاف كيف يمكن لـ Devly تحويل تواجدهم الرقمي! تحدث بشكل طبيعي دون استخدام "ملاحظة:" أو بادئات رسمية.`
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
    const language = detectLanguage(message);
    const { intent, keyword } = extractSearchIntent(message);
    const detectedService = detectServiceType(message);
    
    console.log(`🔍 Language: ${language}, Intent: ${intent}, Keyword: "${keyword}"`);
    if (detectedService) {
      console.log(`🎯 Detected Service: ${detectedService}`);
    }

    const greetingPatterns = /^(hello|hi|hey|bonjour|salut|مرحبا|السلام عليكم)$/i;
    const isSimpleGreeting = greetingPatterns.test(message.trim());
    
    const needsSanityData = !isSimpleGreeting && (
      intent === 'pricing' ||
      intent === 'team' ||
      intent === 'services' ||
      intent === 'listAll' ||
      intent === 'featured' ||
      intent === 'category' ||
      intent === 'details' ||
      intent === 'search' ||
      intent === 'examples' ||
      message.toLowerCase().match(/\b(show|display|example|portfolio|work|projects?|services?|what (do|can) you|capabilities|team|about|who|voir|afficher|عرض|مشاريع|خدمات|فريق)\b/)
    );

    let projectsContext = null;
    let servicesContext = null;
    let pricingContext = null;
    let teamContext = null;
    let projects = [];

    if (needsSanityData) {
      const query = buildSmartQuery(intent, keyword, language);
      console.log(`📝 GROQ Query: ${query.substring(0, 100)}...`);
      
      try {
        const sanityRes = await axios.get(
          `${SANITY_API_URL}?query=${encodeURIComponent(query)}`
        );

        const result = sanityRes.data.result;
        
        if (intent === 'pricing') {
          pricingContext = formatPricingData(result, language, detectedService);
        } else if (intent === 'team') {
          teamContext = formatTeamData(result, language);
        } else {
          projects = result;
          
          if (projects && projects.length > 0) {
            projectsContext = formatProjectData(projects, language);
            
            if (intent === 'services') {
              servicesContext = extractServices(projects, language);
            }
          }
        }
      } catch (sanityError) {
        console.error("Sanity query error:", sanityError.message);
      }
    }

    const conversationContext = conversationHistory
      .slice(-8)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const mentionedProjectType = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/website|app|application|ecommerce|e-commerce|shop|store|design|blog|portfolio|chatbot|mobile|platform|système|site web|application mobile|متجر|موقع|تطبيق/));
    
    const mentionedFeatures = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/feature|functionality|need|want|require|login|payment|dashboard|admin|api|integration|besoin|fonctionnalité|خاصية|ميزة|احتاج/));
    
    const mentionedBudget = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/budget|price|cost|pay|affordable|expensive|prix|coût|payer|سعر|تكلفة|ميزانية/));
    
    const mentionedTimeline = conversationHistory.some(msg => 
      msg.content.toLowerCase().match(/timeline|deadline|when|launch|urgent|quickly|asap|soon|délai|quand|lancement|متى|موعد|سريع/));
    
    const mentionedGoals = conversationHistory.some(msg =>
      msg.content.toLowerCase().match(/goal|objective|want to|trying to|help me|increase|improve|grow|objectif|but|هدف|أريد|أحاول/));
    
    const userAgreesToContact = message.toLowerCase().match(
      /\b(yes|yeah|yep|sure|ok|okay|fine|let'?s (do it|go)|sounds? good|perfect|great|i'?m in|go ahead|proceed|agree|how (can|do) i contact|contact (you|devly|team)|get in touch|reach (out|you)|send (me|you)|email|phone|call|نعم|حسنا|موافق|تمام|كيف أتواصل|oui|d'?accord|parfait|allons-y|comment vous contacter)\b/i
    );
    
    const recentlyAskedForContact = conversationHistory.slice(-2).some(msg =>
      msg.role === 'assistant' && msg.content.toLowerCase().match(/contact|email|phone|proposal|reach|connect|coordonnées|contacter|proposition|تواصل|بريد|هاتف|عرض/)
    );
    
    const detailsCollected = [
      mentionedProjectType,
      mentionedFeatures,
      mentionedGoals,
      mentionedBudget || mentionedTimeline
    ].filter(Boolean).length;
    
    const isFirstMessage = conversationHistory.length === 0;

    const asksHowToContact = message.toLowerCase().match(
      /\b(how (can|do) i contact|contact (you|devly|team)|get in touch|reach (out|you)|send (me|you) (your|the)|give me (your|the)|كيف أتواصل|comment (vous )?contacter)\b/i
    );

    let userPrompt = '';
    
    if (isFirstMessage && isSimpleGreeting) {
      userPrompt = `This is the user's first message: "${message}"\n\n`;
      userPrompt += `Give them a warm, professional welcome as Devly's AI assistant. Ask what brings them here today and what they're looking to create/achieve. Keep it brief (2-3 sentences). Be enthusiastic but professional. Do NOT use "Note:" or similar prefixes.`;
      
    } else if (intent === 'team' && teamContext) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User asked about the team/company: "${message}"\n\n`;
      userPrompt += `Information about Devly:\n${teamContext}\n\n`;
      userPrompt += `IMPORTANT: Present this information naturally and enthusiastically:
      - Share our story and expertise conversationally (rewrite in your own words!)
      - Mention we're based in Algeria and passionate about digital innovation
      - Highlight the services we offer
      - Share contact info naturally if available
      - Ask if they'd like to know more about any specific service
      - Keep it warm and professional (2-4 sentences)
      - Do NOT use "Note:" or similar prefixes - speak naturally`;
      
    } else if (intent === 'pricing' && pricingContext) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User asked about pricing/timeline: "${message}"\n\n`;
      if (detectedService) {
        userPrompt += `Detected Service Type: ${detectedService}\n\n`;
      }
      userPrompt += `Our Pricing Information:\n${pricingContext}\n\n`;
      userPrompt += `IMPORTANT: Present this pricing information naturally and conversationally:
      - The pricing data ${detectedService ? 'is specifically for ' + detectedService : 'shows our different service packages'}
      - Explain that pricing depends on the specific features and complexity
      - Give them a sense of typical ranges based on the data (rewrite in your own words!)
      - Mention that timelines vary based on scope
      - ${detectedService ? 'Ask about specific features they need for their ' + detectedService.toLowerCase() : 'Ask what type of project they\'re interested in to give more specific guidance'}
      - Keep it helpful and non-pushy (2-4 sentences)
      - Be enthusiastic about helping them build their project
      - Do NOT use "Note:" or similar prefixes - integrate info naturally`;
      
    } else if (intent === 'pricing' && !pricingContext) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User asked about pricing: "${message}"\n\n`;
      userPrompt += `You do NOT have pricing data available. IMPORTANT:
      - Do NOT make up or guess any prices
      - Explain that pricing varies based on project complexity and requirements
      - Suggest connecting with the team to get an accurate, personalized quote
      - Be enthusiastic and helpful
      - Ask: "Would you like me to get your contact information so our team can provide you with an exact quote tailored to your needs?"
      - Keep it friendly (2-3 sentences)
      - Do NOT use "Note:" or similar prefixes`;
      
    } else if (needsSanityData && (projectsContext || servicesContext)) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's question: "${message}"\n\n`;
      
      if (servicesContext) {
        userPrompt += `Our Services/Capabilities:\n${servicesContext}\n\n`;
        userPrompt += `IMPORTANT: Rewrite this information in your own conversational words. Don't copy-paste. Make it natural and relevant to their question. Explain what we do and how it can help them. Keep it concise (3-4 sentences max). Do NOT use "Note:" or similar prefixes.`;
      } else if (projectsContext) {
        userPrompt += `Relevant projects from our portfolio:\n${projectsContext}\n\n`;
        userPrompt += `IMPORTANT: Present these projects naturally in your own words - don't copy the data! 
        - Pick 2-3 most relevant ones
        - Describe what we built and the outcomes
        - Connect it to their potential needs
        - Mention the technologies we used (like React, Node.js, etc.)
        - Make it conversational and engaging
        - Keep each project description to 2-3 sentences
        - Do NOT use "Note:" or similar prefixes
        Then ask a follow-up question about their specific requirements.`;
      }
      
    } else if (needsSanityData && !projectsContext && !servicesContext && !pricingContext && !teamContext) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User asked: "${message}"\n\n`;
      userPrompt += `We don't have specific matching portfolio items for this exact query, but Devly can definitely build it! 
      - Acknowledge what they're looking for
      - Express confidence in our ability to deliver
      - Mention relevant technologies/expertise we have (React, Next.js, Node.js, Flutter, AI/ML, etc.)
      - Ask about their specific requirements
      - Keep it positive and professional (2-3 sentences)
      - Do NOT use "Note:" or similar prefixes`;
      
    } else if (recentlyAskedForContact && userAgreesToContact) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User agreed to share contact: "${message}"\n\n`;
      userPrompt += `Great! They're ready to move forward. Acknowledge their agreement warmly and let them know you'll need their contact information. Be brief (1-2 sentences) and enthusiastic. The contact form will appear automatically. Do NOT use "Note:" or similar prefixes.`;
      
    } else if (asksHowToContact && detailsCollected >= 1) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User is asking how to contact: "${message}"\n\n`;
      userPrompt += `Perfect! They want to connect with the team. Respond enthusiastically saying you'll get their contact information so the team can reach out with a personalized proposal. Be brief (1-2 sentences). The contact form will appear. Do NOT use "Note:" or similar prefixes.`;
      
    } else if (detailsCollected >= 2 && !recentlyAskedForContact) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's latest: "${message}"\n\n`;
      userPrompt += `You have good understanding of their project. Now:
      1. Briefly address their latest message
      2. Express confidence that Devly can help
      3. ASK for permission: "Would you like me to connect you with our team to discuss a detailed proposal and exact pricing?" or similar
      - Keep it natural and non-pushy
      - Wait for their response before showing contact form
      - Do NOT use "Note:" or similar prefixes`;
      
    } else if (mentionedProjectType && !mentionedFeatures) {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's latest: "${message}"\n\n`;
      userPrompt += `They've mentioned wanting to build something. Ask relevant follow-up questions about:
      - Specific features they need
      - Their goals/objectives
      - Who their target users are
      - Any specific challenges they're facing
      Pick 1-2 questions that make sense. Be conversational and show genuine interest (2-3 sentences). Do NOT use "Note:" or similar prefixes.`;
      
    } else {
      userPrompt = `Conversation so far:\n${conversationContext}\n\n`;
      userPrompt += `User's latest: "${message}"\n\n`;
      userPrompt += `Continue the discovery conversation. Ask insightful questions to understand:
      - What they want to create/achieve
      - What problem they're solving
      - Who it's for
      Be helpful, professional, and genuinely interested. Keep response focused (2-3 sentences max). Do NOT use "Note:" or similar prefixes.`;
    }

    const aiRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [
          { 
            role: "system", 
            content: getSystemPrompt(language) + "\n\nCRITICAL RULES:\n- ALWAYS rewrite project/service/pricing/team data in your own words - never copy-paste\n- Make it conversational and natural\n- Focus on value and benefits\n- Only show contact form when user explicitly agrees\n- NEVER use 'Note:', 'Important:', 'PS:', or similar prefixes - speak naturally\n- For pricing: ONLY mention if you have database data, otherwise suggest team contact\n- Respond ONLY to the user's actual message, don't continue the conversation yourself"
          },
          { 
            role: "user", 
            content: userPrompt 
          }
        ],
        temperature: 0.7,
        max_tokens: 300,
        stop: ["\nUser:", "User's latest:", "\n\n\n", "Note:", "Important:", "PS:"]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let reply = aiRes.data.choices[0].message.content;
    
    reply = reply.replace(/^(Note|Important|PS|NB|P\.S\.|N\.B\.):?\s*/gi, '');
    reply = reply.replace(/\n(Note|Important|PS|NB|P\.S\.|N\.B\.):?\s*/gi, '\n');

    const shouldShowContactForm = 
      ((recentlyAskedForContact && userAgreesToContact) || 
       (asksHowToContact && detailsCollected >= 1)) &&
      detailsCollected >= 1;

    res.json({ 
      reply,
      showTeamButton: intent === 'team' && teamContext,
      metadata: {
        language,
        intent,
        detectedService,
        projectsFound: projects?.length || 0,
        hasPricingData: !!pricingContext,
        hasTeamData: !!teamContext,
        conversationStage: isFirstMessage ? 'greeting' : 
                          intent === 'team' ? 'team_info' :
                          intent === 'pricing' ? 'pricing_info' :
                          needsSanityData ? 'showing_info' : 
                          shouldShowContactForm ? 'ready_for_contact' :
                          detailsCollected >= 2 ? 'ask_for_contact_permission' :
                          'discovery',
        detailsCollected,
        userAgreed: !!userAgreesToContact,
        askedForContactPermission: recentlyAskedForContact
      }
    });

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    
    const errorMessages = {
      en: "I apologize, but I'm experiencing technical difficulties. Please try again or contact us directly at contact@devly.dz",
      fr: "Je m'excuse, mais je rencontre des difficultés techniques. Veuillez réessayer ou nous contacter directement à contact@devly.dz",
      ar: "أعتذر، لكني أواجه صعوبات تقنية. يرجى المحاولة مرة أخرى أو الاتصال بنا مباشرة على contact@devly.dz"
    };
    
    const language = detectLanguage(req.body.message);
    res.status(500).json({ 
      reply: errorMessages[language] || errorMessages.en 
    });
  }
});

// 🎯 Get services for initial buttons
app.get("/services", async (req, res) => {
  try {
    const query = `*[_type == "pricingSection"][0] {
      cards[] {
        cardTitle,
        cardSubtitle,
        iconType,
        iconSvg,
        "iconImageUrl": iconImage.asset->url
      }
    }`;

    const sanityRes = await axios.get(
      `${SANITY_API_URL}?query=${encodeURIComponent(query)}`
    );

    const pricingData = sanityRes.data.result;
    
    if (!pricingData || !pricingData.cards) {
      return res.json({ services: [] });
    }

    const services = pricingData.cards.map(card => ({
      title: card.cardTitle?.en || card.cardTitle?.fr || 'Service',
      subtitle: card.cardSubtitle?.en || card.cardSubtitle?.fr || null,
      icon: card.iconType === 'svg' ? null : card.iconImageUrl,
      iconEmoji: getServiceEmoji(card.cardTitle?.en || card.cardTitle?.fr)
    }));

    res.json({ services });
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ 
      services: [
        { title: "Professional Websites", subtitle: "Modern & responsive", iconEmoji: "🌐" },
        { title: "Mobile App Development", subtitle: "iOS & Android", iconEmoji: "📱" },
        { title: "Custom Software", subtitle: "Tailored solutions", iconEmoji: "⚙️" },
        { title: "AI & Automation", subtitle: "Smart integrations", iconEmoji: "🤖" },
        { title: "UI/UX Design", subtitle: "Beautiful interfaces", iconEmoji: "🎨" },
        { title: "E-commerce", subtitle: "Online stores", iconEmoji: "🛒" }
      ]
    });
  }
});

function getServiceEmoji(serviceName) {
  const emojiMap = {
    'professional websites': '🌐',
    'website': '🌐',
    'web': '🌐',
    'mobile app': '📱',
    'app': '📱',
    'custom software': '⚙️',
    'software': '⚙️',
    'artificial intelligence': '🤖',
    'ai': '🤖',
    'automation': '🤖',
    'voice ai': '🎤',
    'ecommerce': '🛒',
    'e-commerce': '🛒',
    'design': '🎨',
    'ui/ux': '🎨',
    'marketing': '📈',
    'seo': '📊'
  };

  const normalizedName = (serviceName || '').toLowerCase();
  
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (normalizedName.includes(key)) {
      return emoji;
    }
  }
  
  return '✨';
}

// 📧 ENHANCED Contact form submission endpoint with Telegram integration
app.post("/contact", async (req, res) => {
  const { name, email, phone, conversationSummary, selectedService } = req.body;

  console.log("📧 New contact form submission:");
  console.log(`   Name: ${name}`);
  console.log(`   Email: ${email}`);
  console.log(`   Phone: ${phone}`);
  console.log(`   Selected Service: ${selectedService || 'Not specified'}`);
  console.log(`   Conversation length: ${conversationSummary?.length || 0} messages`);

  // Validate required fields
  if (!name || !email || !phone) {
    return res.status(400).json({ 
      success: false,
      message: "Missing required fields: name, email, or phone"
    });
  }

  try {
    // Generate AI summary of the conversation
    const aiSummary = await generateConversationSummary(
      conversationSummary || [],
      selectedService,
      'en'
    );

    console.log("🤖 AI Generated Summary:");
    console.log(aiSummary);

    // Send to Telegram
    const telegramSent = await sendTelegramNotification(
      { name, email, phone },
      aiSummary,
      selectedService
    );

    if (telegramSent) {
      console.log("✅ Contact submitted and Telegram notification sent!");
    } else {
      console.log("⚠️ Contact submitted but Telegram notification failed");
    }

    // TODO: You can also save to a database here if needed
    // await saveToDatabase({ name, email, phone, summary: aiSummary, selectedService });

    res.json({ 
      success: true,
      message: "Contact information received successfully",
      notificationSent: telegramSent
    });

  } catch (error) {
    console.error("❌ Error processing contact:", error);
    res.status(500).json({ 
      success: false,
      message: "Error processing contact information",
      error: error.message
    });
  }
});

// 🏥 Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    service: "Devly Smart Chatbot API",
    timestamp: new Date().toISOString(),
    sanityConnected: !!(SANITY_PROJECT_ID && SANITY_DATASET),
    telegramConfigured: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Devly Smart Chatbot Server running on port ${PORT}`);
  console.log(`📊 Sanity CMS: ${SANITY_PROJECT_ID ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`📱 Telegram Bot: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? '✅ Configured' : '❌ Not configured'}`);
});