const express = require('express');
const fs = require('fs');
const path = require('path');

// Mock db and scheduler to prevent connections/crons from starting
jestMock();

function jestMock() {
  const dbPath = path.join(__dirname, '../config/db');
  require(dbPath);
  require.cache[require.resolve(dbPath)].exports = {
    initializeDatabase: async () => {},
    query: async () => [],
    getConnectionStatus: () => true,
    getPool: () => null
  };

  const schedulerPath = path.join(__dirname, '../utils/scheduler');
  require(schedulerPath);
  require.cache[require.resolve(schedulerPath)].exports = {
    initScheduler: () => {},
    seedMasterContests: async () => ({ count: 0 })
  };
}

// Now require server/app or build mock app
const app = express();

// Import controllers to build function map
const controllers = {};
const controllersDir = path.join(__dirname, '../controllers');
fs.readdirSync(controllersDir).forEach(file => {
  if (file.endsWith('.js')) {
    const name = file.replace('.js', '');
    controllers[name] = require(path.join(controllersDir, file));
  }
});

// Build function mapping (function reference -> name)
const funcToName = new Map();
for (const [controllerName, moduleExports] of Object.entries(controllers)) {
  for (const [funcName, func] of Object.entries(moduleExports)) {
    if (typeof func === 'function') {
      funcToName.set(func, `${controllerName}.${funcName}`);
    }
  }
}

// Helper to extract routes
const routesList = [];

// Import routes and mount them
const routesDir = path.join(__dirname, '../routes');
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

routeFiles.forEach(file => {
  const routePath = path.join(routesDir, file);
  const router = require(routePath);
  
  // Try to find how it's mapped in server.js, or map manually
  let mountPath = '/api/' + file.replace('.js', '');
  if (file === 'contestLeaderboardSync.js') {
    mountPath = '/api/contest';
  } else if (file === 'contests.js') {
    mountPath = '/api/contests';
  } else if (file === 'departments.js') {
    mountPath = '/api/departments';
  }

  app.use(mountPath, router);
});

// Traverse Express Router Stack
function split(thing) {
  if (typeof thing === 'string') {
    return thing.split('/');
  } else if (thing.fast_slash) {
    return '';
  } else {
    var match = thing.toString()
      .replace('\\/?', '')
      .replace('(?=\\/|$)', '$')
      .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^$^*\/]+)+)\$\//);
    return match
      ? match[1].replace(/\\(.)/g, '$1').split('/')
      : '<complex:' + thing.toString() + '>';
  }
}

const usedFunctions = new Set();

function traverseStack(stack, prefix = '') {
  stack.forEach(middleware => {
    if (middleware.route) { // routes registered directly on the app
      const pathStr = prefix + middleware.route.path;
      const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase());
      middleware.route.stack.forEach(handler => {
        const controllerFunc = funcToName.get(handler.handle);
        if (controllerFunc) {
          usedFunctions.add(controllerFunc);
        }
        
        // Find middleware in stack
        const handlerIndex = middleware.route.stack.indexOf(handler);
        const prevHandlers = middleware.route.stack.slice(0, handlerIndex);
        const appliedMiddlewares = prevHandlers.map(h => {
          if (h.name === 'authenticate') return 'authenticate';
          if (h.name === 'bound ') return 'authorize'; // authorize(...) returns bound function sometimes
          return h.name || 'anonymous';
        });

        routesList.push({
          methods,
          path: pathStr,
          controller: controllerFunc || 'inline/unknown',
          routeFile: path.basename(prefix), // rough estimate, we'll fix
          middlewares: appliedMiddlewares
        });
      });
    } else if (middleware.name === 'router') { // router middleware
      const newPrefix = prefix + (split(middleware.regexp).filter(Boolean).join('/') ? '/' + split(middleware.regexp).filter(Boolean).join('/') : '');
      traverseStack(middleware.handle.stack, newPrefix);
    }
  });
}

traverseStack(app._router.stack);

// Now process the results
console.log('=== ENDPOINTS FOUND ===');
console.log(JSON.stringify(routesList, null, 2));

console.log('\n=== UNUSED CONTROLLER FUNCTIONS ===');
const unused = [];
for (const [controllerName, moduleExports] of Object.entries(controllers)) {
  for (const [funcName, func] of Object.entries(moduleExports)) {
    if (typeof func === 'function') {
      const fullName = `${controllerName}.${funcName}`;
      if (!usedFunctions.has(fullName)) {
        unused.push(fullName);
      }
    }
  }
}
console.log(JSON.stringify(unused, null, 2));
