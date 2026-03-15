var socket = io('http://localhost:8000');
var camera, controls, scene, renderer, stats;
var light, mesh;
var mixer, morphs = [];
var playerFactory, particle, color, id;
var players = [];
var bullets = [];
var xyzLimit = 480; 
var clock = new THREE.Clock();
var textureLoader = new THREE.TextureLoader();
var bulletMap = textureLoader.load("textures/sprite.png");
var loader = new THREE.JSONLoader();

// Physics variables
var velocity = new THREE.Vector3();
var canJump = false;
var isCrouching = false;
var PLAYER_HEIGHT = 25;
var CROUCH_HEIGHT = 12;

// Socket.io
socket.on('init', function (socketID) { id = socketID; });
socket.on('player', function (player) {
    if ('online' in player) {
        playerHandler(player.online[0], player.online[1][0], player.online[1][1]);
    } else if ('offline' in player) {
        scene.remove(players[player.offline]);
        delete players[player.offline];
    }
});
socket.on('bullet', function (bullet) {
    var position = new THREE.Vector3(bullet[0].x, bullet[0].y, bullet[0].z);
    var speed = new THREE.Vector3(bullet[1].x, bullet[1].y, bullet[1].z);
    AddBullet(position, speed, bullet[2]);
});

init();
animate();

// Fire
$(renderer.domElement).click(function () {
    if (document.pointerLockElement === renderer.domElement) {
        var speed = camera.getWorldDirection().multiplyScalar(20);
        AddBullet(camera.position, speed);
        socket.emit('bullet', [controls.object.position, speed]);
    }
});

function init() {
    stats = new Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(-400, PLAYER_HEIGHT, -400); // Start in a corner

    scene = new THREE.Scene();

    // --- LIGHTING ---
    scene.add(new THREE.AmbientLight(0xffffff, 1.0)); 

    // --- ROOM & MAZE CONFIG ---
    var roomWidth = 1000;
    var roomHeight = 400; 
    var roomDepth = 1000;
    var wallColor = 0x6d33a0;

    // Room Shell
    var wallMat = new THREE.MeshBasicMaterial({ color: wallColor, side: THREE.BackSide });
    var floorTex = textureLoader.load('./textures/room/floor.jpg');
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(10, 10);
    var floorMat = new THREE.MeshBasicMaterial({ map: floorTex, side: THREE.BackSide });
    var ceilMat = new THREE.MeshBasicMaterial({ map: textureLoader.load('./textures/room/top.png'), side: THREE.BackSide });

    var roomMaterials = [wallMat, wallMat, ceilMat, floorMat, wallMat, wallMat];
    var room = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, roomHeight, roomDepth), new THREE.MultiMaterial(roomMaterials));
    room.position.y = (roomHeight / 2) - 5; 
    scene.add(room);

    // --- MAZE GENERATION ---
    // 1 = Wall, 0 = Path
    var mazeData = [
        [1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,1,0,0,0,0,1],
        [1,0,1,0,1,0,1,1,0,1],
        [1,0,1,0,0,0,0,1,0,1],
        [1,0,1,1,1,1,0,1,0,1],
        [1,0,0,0,0,1,0,0,0,1],
        [1,1,1,1,0,1,1,1,0,1],
        [1,0,0,0,0,0,0,1,0,1],
        [1,0,1,1,1,1,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1]
    ];

    var blockSize = 100;
    var mazeWallGeo = new THREE.BoxGeometry(blockSize, roomHeight, blockSize);
    var mazeWallMat = new THREE.MeshBasicMaterial({ color: wallColor });

    for(var z = 0; z < mazeData.length; z++) {
        for(var x = 0; x < mazeData[z].length; x++) {
            if(mazeData[z][x] === 1) {
                var wall = new THREE.Mesh(mazeWallGeo, mazeWallMat);
                // Offset calculation to center the maze in the 1000x1000 room
                wall.position.set(x * blockSize - 450, roomHeight/2 - 5, z * blockSize - 450);
                scene.add(wall);
            }
        }
    }

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // --- CONTROLS ---
    controls = new THREE.FirstPersonControls(camera, renderer.domElement);
    controls.movementSpeed = 150;
    controls.lookSpeed = 0.1; 
    controls.enabled = false;
    controls.verticalMin = 0; 
    controls.verticalMax = Math.PI;

    document.addEventListener('pointerlockchange', function () {
        const isLocked = document.pointerLockElement === renderer.domElement;
        controls.enabled = isLocked;
        controls.activeLook = false; 
    });

    document.addEventListener('mousemove', function(event) {
        if (document.pointerLockElement === renderer.domElement && controls.enabled) {
            controls.lon += (event.movementX || 0) * controls.lookSpeed;
            controls.lat -= (event.movementY || 0) * controls.lookSpeed;
            if (controls.lat > 89.99) controls.lat = 89.99;
            if (controls.lat < -89.99) controls.lat = -89.99;
        }
    });

    window.addEventListener('keydown', function(e) {
        switch(e.code) {
            case 'Space': if (canJump) velocity.y += 250; canJump = false; break;
            case 'ControlLeft': isCrouching = true; controls.movementSpeed = 70; break;
            case 'ShiftLeft': if (!isCrouching) controls.movementSpeed = 300; break;
        }
    });

    window.addEventListener('keyup', function(e) {
        switch(e.code) {
            case 'ControlLeft': isCrouching = false; controls.movementSpeed = 150; break;
            case 'ShiftLeft': controls.movementSpeed = 150; break;
        }
    });

    window.addEventListener('resize', onWindowResize, false);
}

function animate() {
    stats.begin();
    requestAnimationFrame(animate);
    var delta = clock.getDelta();

    if (controls.enabled) {
        velocity.y -= 9.8 * 60.0 * delta; 
        controls.object.position.y += velocity.y * delta;
        var targetHeight = isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
        if (controls.object.position.y <= targetHeight) {
            velocity.y = 0;
            controls.object.position.y = targetHeight;
            canJump = true;
        }
    }

    socket.emit('player', [controls.object.position]);
    
    for (var i = bullets.length - 1; i >= 0; i--) {
        bullets[i].particle.position.add(bullets[i].speed);
        if (bullets[i].particle.position.length() > 2000) {
            scene.remove(bullets[i].particle);
            bullets.splice(i, 1);
        }
    }
    
    restrictField(controls, xyzLimit);
    render(delta);
    stats.end();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    controls.handleResize();
}

function render(delta) {
    controls.update(delta);
    renderer.render(scene, camera);
}

function restrictField(controls, restrict) {
    var pos = controls.object.position;
    pos.x = Math.max(-restrict, Math.min(restrict, pos.x));
    pos.z = Math.max(-restrict, Math.min(restrict, pos.z));
}

renderer.domElement.addEventListener("click", function() {
    this.requestPointerLock();
});

function playerHandler(id, position) {
    if (!players[id]) {
        var p = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 10), new THREE.MeshBasicMaterial({color: 0xff0000}));
        scene.add(p);
        players[id] = p;
    }
    players[id].position.set(position.x, position.y, position.z);
}

function AddBullet(position, speed) {
    var m = new THREE.SpriteMaterial({map: bulletMap, color: 0xffffff});
    var p = new THREE.Sprite(m);
    p.position.copy(position);
    p.scale.set(1.5, 1.5, 1.5);
    bullets.push({particle: p, speed: speed});
    scene.add(p);
}