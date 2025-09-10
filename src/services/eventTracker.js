const Database = require('better-sqlite3');
const path = require('path');
const { getGeolocation, formatLocation } = require('../utils/geolocation');

class EventTracker {
  constructor() {
    try {
      const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '../db/slocial.db');
      this.db = new Database(dbFile);
      
      // Check if events table exists
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get();
      
      if (tableExists) {
        // Prepare statements for better performance
        this.insertStmt = this.db.prepare(`
          INSERT INTO events (event_type, user_id, session_id, ip_address, user_agent, path, method, letter_id, duration_ms, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      } else {
        console.warn('Events table does not exist. Run migrations: npm run migrate');
        this.insertStmt = null;
      }
      
      // Track active page views for duration calculation
      this.activeViews = new Map();
      // Track session data
      this.sessionData = new Map();
    } catch (error) {
      console.error('EventTracker initialization error:', error);
      this.db = null;
      this.insertStmt = null;
      this.activeViews = new Map();
      this.sessionData = new Map();
    }
  }

  async track(eventType, data = {}) {
    try {
      if (!this.insertStmt) {
        // Silently skip if events table doesn't exist
        return;
      }
      
      const {
        userId = null,
        sessionId = null,
        ipAddress = null,
        userAgent = null,
        path = null,
        method = null,
        letterId = null,
        durationMs = null,
        metadata = {}
      } = data;

      // Track session start if this is the first event for this session
      if (sessionId && !this.sessionData.has(sessionId)) {
        await this.startSession(sessionId, ipAddress, userAgent);
      }

      // Add geolocation to metadata if we have an IP
      if (ipAddress && sessionId) {
        const sessionInfo = this.sessionData.get(sessionId);
        if (sessionInfo && sessionInfo.location) {
          metadata.location = sessionInfo.location;
        }
      }

      this.insertStmt.run(
        eventType,
        userId,
        sessionId,
        ipAddress,
        userAgent,
        path,
        method,
        letterId,
        durationMs,
        JSON.stringify(metadata)
      );
    } catch (error) {
      console.error('Error tracking event:', error);
    }
  }

  async startSession(sessionId, ipAddress, userAgent) {
    try {
      // Get geolocation for this IP
      const geo = await getGeolocation(ipAddress);
      const location = formatLocation(geo);
      
      // Store session data
      this.sessionData.set(sessionId, {
        startTime: Date.now(),
        ipAddress,
        userAgent,
        location,
        geo,
        eventCount: 0,
        pagesVisited: new Set()
      });
      
      // Track session start event
      this.insertStmt.run(
        'session_start',
        null,
        sessionId,
        ipAddress,
        userAgent,
        null,
        null,
        null,
        null,
        JSON.stringify({ location, geo })
      );
    } catch (error) {
      console.error('Error starting session:', error);
    }
  }

  // Track page view start
  startPageView(sessionId, path) {
    const key = `${sessionId}-${path}`;
    this.activeViews.set(key, Date.now());
  }

  // Track page view end and calculate duration
  endPageView(sessionId, path, userId = null, ipAddress = null, userAgent = null) {
    const key = `${sessionId}-${path}`;
    const startTime = this.activeViews.get(key);
    
    if (startTime) {
      const duration = Date.now() - startTime;
      this.activeViews.delete(key);
      
      // Extract letter ID if viewing a letter
      let letterId = null;
      const letterMatch = path.match(/\/letters\/(\d+)/);
      if (letterMatch) {
        letterId = parseInt(letterMatch[1]);
      }
      
      this.track('page_view', {
        userId,
        sessionId,
        ipAddress,
        userAgent,
        path,
        method: 'GET',
        letterId,
        durationMs: duration,
        metadata: { completed: true }
      });
      
      return duration;
    }
    
    return null;
  }

  // Get events for admin panel
  getRecentEvents(limit = 100, filters = {}) {
    if (!this.db) {
      return [];
    }
    
    try {
      let query = `
        SELECT e.*, u.handle as user_handle
        FROM events e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (filters.eventType) {
        query += ' AND e.event_type = ?';
        params.push(filters.eventType);
      }
      
      if (filters.userId) {
        query += ' AND e.user_id = ?';
        params.push(filters.userId);
      }
      
      if (filters.startDate) {
        query += ' AND e.created_at >= ?';
        params.push(filters.startDate);
      }
      
      query += ' ORDER BY e.created_at DESC LIMIT ?';
      params.push(limit);
      
      const events = this.db.prepare(query).all(...params);
      
      // Parse metadata JSON
      return events.map(event => ({
        ...event,
        metadata: event.metadata ? JSON.parse(event.metadata) : {}
      }));
    } catch (error) {
      console.error('Error getting recent events:', error);
      return [];
    }
  }

  // Get events grouped by session
  getSessionGroupedEvents(limit = 50, filters = {}) {
    if (!this.db) {
      return [];
    }
    
    try {
      // First get recent sessions
      let sessionQuery = `
        SELECT DISTINCT session_id, 
               MIN(created_at) as session_start,
               MAX(created_at) as session_end,
               COUNT(*) as event_count,
               MAX(user_id) as user_id,
               MAX(ip_address) as ip_address,
               MAX(user_agent) as user_agent
        FROM events
        WHERE session_id IS NOT NULL
      `;
      
      const sessionParams = [];
      
      if (filters.startDate) {
        sessionQuery += ' AND created_at >= ?';
        sessionParams.push(filters.startDate);
      }
      
      sessionQuery += ' GROUP BY session_id ORDER BY session_start DESC LIMIT ?';
      sessionParams.push(limit);
      
      const sessions = this.db.prepare(sessionQuery).all(...sessionParams);
      
      // For each session, get its events
      const sessionData = sessions.map(session => {
        const events = this.db.prepare(`
          SELECT e.*, u.handle as user_handle, u.avatar_url, u.email, u.bio
          FROM events e
          LEFT JOIN users u ON e.user_id = u.id
          WHERE e.session_id = ?
          ORDER BY e.created_at ASC
        `).all(session.session_id);
        
        // Parse metadata and extract location from first session_start event
        let location = 'Unknown';
        let geo = null;
        const parsedEvents = events.map(event => {
          const parsed = {
            ...event,
            metadata: event.metadata ? JSON.parse(event.metadata) : {}
          };
          
          // Extract location from session_start event
          if (event.event_type === 'session_start' && parsed.metadata.location) {
            location = parsed.metadata.location;
            geo = parsed.metadata.geo;
          }
          
          return parsed;
        });
        
        // Calculate session duration
        const durationMs = new Date(session.session_end) - new Date(session.session_start);
        
        // Get unique pages visited
        const pagesVisited = [...new Set(events
          .filter(e => e.event_type === 'page_view' && e.path)
          .map(e => e.path))];
        
        // Get user info from first event with user data
        const userEvent = events.find(e => e.user_id);
        const userName = userEvent ? userEvent.user_handle : 'Anonymous';
        const userId = userEvent ? userEvent.user_id : null;
        const userAvatar = userEvent ? userEvent.avatar_url : null;
        const userEmail = userEvent ? userEvent.email : null;
        const userBio = userEvent ? userEvent.bio : null;
        
        return {
          sessionId: session.session_id,
          startTime: session.session_start,
          endTime: session.session_end,
          duration: durationMs,
          eventCount: session.event_count,
          userId,
          userName,
          userAvatar,
          userEmail,
          userBio,
          ipAddress: session.ip_address,
          userAgent: session.user_agent,
          location,
          geo,
          pagesVisited,
          events: parsedEvents
        };
      });
      
      return sessionData;
    } catch (error) {
      console.error('Error getting session grouped events:', error);
      return [];
    }
  }

  // Get analytics summary
  getAnalytics(period = '24h') {
    if (!this.db) {
      return {
        totalEvents: 0,
        uniqueVisitors: 0,
        pageViews: 0,
        logins: 0,
        avgReadingTime: 0,
        topPages: [],
        eventTypes: []
      };
    }
    
    try {
      const periodMap = {
        '1h': "datetime('now', '-1 hour')",
        '24h': "datetime('now', '-1 day')",
        '7d': "datetime('now', '-7 days')",
        '30d': "datetime('now', '-30 days')"
      };
      
      const since = periodMap[period] || periodMap['24h'];
      
      const stats = {
      totalEvents: this.db.prepare(`
        SELECT COUNT(*) as count FROM events WHERE created_at >= ${since}
      `).get().count,
      
      uniqueVisitors: this.db.prepare(`
        SELECT COUNT(DISTINCT session_id) as count 
        FROM events WHERE created_at >= ${since}
      `).get().count,
      
      pageViews: this.db.prepare(`
        SELECT COUNT(*) as count FROM events 
        WHERE event_type = 'page_view' AND created_at >= ${since}
      `).get().count,
      
      webRequests: this.db.prepare(`
        SELECT COUNT(*) as count FROM events 
        WHERE event_type = 'web_request' AND created_at >= ${since}
      `).get().count,
      
      newVisitors: this.db.prepare(`
        SELECT COUNT(*) as count FROM events 
        WHERE event_type = 'new_visitor' AND created_at >= ${since}
      `).get().count,
      
      logins: this.db.prepare(`
        SELECT COUNT(*) as count FROM events 
        WHERE event_type = 'login' AND created_at >= ${since}
      `).get().count,
      
      avgReadingTime: this.db.prepare(`
        SELECT AVG(duration_ms) as avg FROM events 
        WHERE event_type = 'page_view' AND path LIKE '/letters/%' 
        AND duration_ms IS NOT NULL AND created_at >= ${since}
      `).get().avg || 0,
      
      topPages: this.db.prepare(`
        SELECT path, COUNT(*) as views FROM events 
        WHERE event_type = 'page_view' AND created_at >= ${since}
        GROUP BY path ORDER BY views DESC LIMIT 10
      `).all(),
      
      eventTypes: this.db.prepare(`
        SELECT event_type, COUNT(*) as count FROM events 
        WHERE created_at >= ${since}
        GROUP BY event_type ORDER BY count DESC
      `).all()
      };
      
      return stats;
    } catch (error) {
      console.error('Error getting analytics:', error);
      return {
        totalEvents: 0,
        uniqueVisitors: 0,
        pageViews: 0,
        logins: 0,
        avgReadingTime: 0,
        topPages: [],
        eventTypes: []
      };
    }
  }

  // Clean up old events (optional, for maintenance)
  cleanup(daysToKeep = 90) {
    const deleted = this.db.prepare(`
      DELETE FROM events WHERE created_at < datetime('now', '-${daysToKeep} days')
    `).run();
    
    return deleted.changes;
  }

  close() {
    this.db.close();
  }
}

// Create singleton instance
const tracker = new EventTracker();

module.exports = tracker;
