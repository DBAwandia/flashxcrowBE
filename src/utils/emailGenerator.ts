// Helper: generate email HTML content
export function wrapEmailTemplate(content: string, email: string): string {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shadowmax Updates</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f7; margin: 0; padding: 0; }
      .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
      .header { background-color: #3B82F6; padding: 30px 20px; text-align: center; }
      .content { padding: 30px; }
      h1 { color: #3B82F6; margin-top: 0; font-size: 24px; }
      p { font-size: 16px; margin-bottom: 20px; line-height: 1.5; }
      a { color: #3B82F6; text-decoration: none; }
      .cta-button { background-color: #3B82F6; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 600; display: inline-block; margin: 10px 0; }
      ul { padding-left: 20px; }
      li { margin-bottom: 10px; }
      .footer { text-align: center; padding: 20px; font-size: 14px; background-color: #f5f5f5; color: #666; }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Shadowmax. All rights reserved.</p>
        <p>
          <a href="https://shadowmaxproxy.com/privacy">Privacy Policy</a> |
          <a href="https://shadowmaxproxy.com/terms">Terms of Service</a>
        </p>
       <p>
        <a href="https://shadowmaxproxy.com/setup-proxy">View all proxy locations (USA, India, UK...)</a>
      </p>
      </div>
    </div>
  </body>
  </html>
  `;
}
// Helper functions
export function getRangeLabel(range: string): string {
  const labels: Record<string, string> = {
    thisMonth: "this month",
    lastMonth: "last month",
    beforeLastMonth: "before last month",
  };
  return labels[range] || range;
}

// Marketing email templates
export const marketingTemplates = {
  user: {
    thisMonth: {
      subject:
        "🚀 Welcome to Shadowmaxproxy - Get Started with Your New Account!",
      html: (email: string) => `
        <h1>Welcome to Shadowmaxproxy!</h1>
        <p>We're excited to have you join us this month. Here's what you get:</p>
        <ul>
          <li>Premium proxy access</li>
          <li>24/7 customer support</li>
          <li>Special new user discounts</li>
        </ul>
        <a href="https://shadowmaxproxy.com">Start Exploring</a>
      `,
    },
    lastMonth: {
      subject:
        "🔓 Unlock More Residential Proxies - Your Shadowmax Journey Continues",
      html: (email: string) => `
        <h1>Your First Month with Shadowmaxproxy!</h1>
        <p>We noticed you joined last month - ready to level up?</p>
        <p>Upgrade now for advanced features:</p>
        <ul>
          <li>Higher bandwidth limits</li>
          <li>More geographic locations</li>
          <li>Priority support</li>
        </ul>
        <a href="https://shadowmaxproxy.com">Upgrade Now</a>
      `,
    },
    beforeLastMonth: {
      subject: "🌟 Loyal User Rewards - Special Offer Just For You",
      html: (email: string) => `
        <h1>Thank You for Being a Long-Time Shadowmaxproxy User!</h1>
        <p>As our valued user, we're offering exclusive benefits:</p>
        <ul>
          <li>20% discount on annual plans</li>
          <li>Early access to new features</li>
          <li>Dedicated account manager</li>
        </ul>
        <a href="https://shadowmaxproxy.com">Claim Your Rewards</a>
      `,
    },
  },
  transaction: {
    thisMonth: {
      subject:
        "🔥Shadowmaxproxy Hot Deal - Extra Credits for Your Recent Activity",
      html: (email: string) => `
        <h1>We Appreciate Your Recent Transactions!</h1>
        <p>Get bonus credits when you purchase this month:</p>
        <ul>
          <li>10% extra on all packages</li>
          <li>Double referral bonuses</li>
          <li>Limited-time offers</li>
        </ul>
        <a href="https://shadowmaxproxy.com">View Current Deals</a>
      `,
    },
    lastMonth: {
      subject: "💎 Exclusive Offer - Reactivate Your Shadowmax Proxy Usage",
      html: (email: string) => `
        <h1>We Miss Your Activity!</h1>
        <p>Your last transaction was last month - here's a special offer:</p>
        <ul>
          <li>15% discount on your next purchase</li>
          <li>Free bandwidth boost</li>
          <li>Priority queue access</li>
        </ul>
        <a href="https://shadowmaxproxy.com">Reactivate Now</a>
      `,
    },
    beforeLastMonth: {
      subject: "🎁 Welcome Back - Special Relaunch Offer Inside",
      html: (email: string) => `
        <h1>It's Been A While - We Have Something Special For You!</h1>
        <p>Reactivate your account with these exclusive benefits:</p>
        <ul>
          <li>30-day money-back guarantee</li>
          <li>Free month of premium features</li>
          <li>Personalized setup assistance</li>
        </ul>
        <a href="https://shadowmaxproxy.com">Relaunch Your Account</a>
      `,
    },
  },
};
