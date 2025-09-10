const https = require('https');

// Cache to avoid repeated lookups for the same IP
const geoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get geolocation data for an IP address using ip-api.com (free service)
 * Free tier: 45 requests per minute
 */
async function getGeolocation(ip) {
  // Skip private/local IPs
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return {
      country: 'Local',
      city: 'Local Network',
      region: '',
      lat: null,
      lon: null
    };
  }

  // Check cache
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  return new Promise((resolve) => {
    // Using ip-api.com free service
    const options = {
      hostname: 'ip-api.com',
      path: `/json/${ip}?fields=status,country,countryCode,region,regionName,city,lat,lon`,
      method: 'GET',
      timeout: 3000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.status === 'success') {
            const geoData = {
              country: result.country || 'Unknown',
              countryCode: result.countryCode || '',
              city: result.city || 'Unknown',
              region: result.regionName || result.region || '',
              lat: result.lat,
              lon: result.lon
            };
            
            // Cache the result
            geoCache.set(ip, {
              data: geoData,
              timestamp: Date.now()
            });
            
            resolve(geoData);
          } else {
            resolve({
              country: 'Unknown',
              city: 'Unknown',
              region: '',
              lat: null,
              lon: null
            });
          }
        } catch (error) {
          console.error('Error parsing geolocation data:', error);
          resolve({
            country: 'Unknown',
            city: 'Unknown',
            region: '',
            lat: null,
            lon: null
          });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Geolocation request error:', error);
      resolve({
        country: 'Unknown',
        city: 'Unknown',
        region: '',
        lat: null,
        lon: null
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        country: 'Unknown',
        city: 'Unknown',
        region: '',
        lat: null,
        lon: null
      });
    });

    req.end();
  });
}

/**
 * Get a formatted location string from geolocation data
 */
function formatLocation(geo) {
  if (!geo) return 'Unknown';
  
  const parts = [];
  if (geo.city && geo.city !== 'Unknown' && geo.city !== 'Local Network') {
    parts.push(geo.city);
  }
  if (geo.region && geo.region !== geo.city) {
    parts.push(geo.region);
  }
  if (geo.country && geo.country !== 'Unknown' && geo.country !== 'Local') {
    parts.push(geo.country);
  }
  
  return parts.length > 0 ? parts.join(', ') : 'Unknown Location';
}

module.exports = {
  getGeolocation,
  formatLocation
};
