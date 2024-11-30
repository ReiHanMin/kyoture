// validation.js

// Function to clean and standardize price_tier values
export const cleanPriceTier = (priceTier) => {
    if (!priceTier || typeof priceTier !== 'string') return 'General';
  
    const normalizedTier = priceTier.trim().toLowerCase();
  
    const tierMapping = {
      'adults': 'Adults',
      'general': 'General',
      'club members': 'Club Members',
      'under 22': 'Under 22',
      'students': 'Students',
      // Add more mappings as needed
    };
  
    for (const [key, value] of Object.entries(tierMapping)) {
      if (normalizedTier.includes(key)) {
        return value;
      }
    }
  
    // Default fallback
    return 'General';
  };
  