import { getRandomFloat, getRandomInt } from "../../random/random";
import { vec3, vec4 } from "gl-matrix";
import { LeaderboardBody } from "../../components/Leaderboard";
import { UniverseSettings } from "../../redux/universeSettingsSlice";
import { HSLtoRGB } from "../colors/conversions";
import { MassThresholds } from "../defines/physics";

const G = 4 * Math.PI * Math.PI; // Gravitational constant

export class Universe {
    public settings: UniverseSettings;

    // Uint8Array and Float32Array are guaranteed to be contiguous in memory, which makes them more performant (cache locality).
    public bodiesActive: Uint8Array;
    public positionsX: Float32Array;
    public positionsY: Float32Array;
    public positionsZ: Float32Array;
    public velocitiesX: Float32Array;
    public velocitiesY: Float32Array;
    public velocitiesZ: Float32Array;
    public accelerationsX: Float32Array;
    public accelerationsY: Float32Array;
    public accelerationsZ: Float32Array;
    public masses: Float32Array;
    public radii: Float32Array;
    public colorsR: Float32Array;
    public colorsG: Float32Array;
    public colorsB: Float32Array;
    public numActive: number;
    public orbitalIndices: Float32Array;
    public orbitalDistances: Float32Array;
    public numSattelites: Float32Array;
    public timeElapsed: number;

    constructor(settings: UniverseSettings) {
        this.settings = settings;
        this.bodiesActive = new Uint8Array(this.settings.numBodies);
        this.positionsX = new Float32Array(this.settings.numBodies);
        this.positionsY = new Float32Array(this.settings.numBodies);
        this.positionsZ = new Float32Array(this.settings.numBodies);

        this.velocitiesX = new Float32Array(this.settings.numBodies);
        this.velocitiesY = new Float32Array(this.settings.numBodies);
        this.velocitiesZ = new Float32Array(this.settings.numBodies);

        this.accelerationsX = new Float32Array(this.settings.numBodies);
        this.accelerationsY = new Float32Array(this.settings.numBodies);
        this.accelerationsZ = new Float32Array(this.settings.numBodies);

        this.masses = new Float32Array(this.settings.numBodies);
        this.radii = new Float32Array(this.settings.numBodies);

        this.colorsR = new Float32Array(this.settings.numBodies);
        this.colorsG = new Float32Array(this.settings.numBodies);
        this.colorsB = new Float32Array(this.settings.numBodies);

        // Stores the index of the body that each body orbits
        this.orbitalIndices = new Float32Array(this.settings.numBodies);
        this.orbitalDistances = new Float32Array(this.settings.numBodies);
        this.numSattelites = new Float32Array(this.settings.numBodies);

        this.numActive = this.settings.numBodies;
        this.timeElapsed = 0;

        this.initialize();
    }

    public radius_from_mass(mass: number): number {
        // The radius to mass ratio is extremely unrealistic for this simulation.
        // If it weren't, we wouldn't be able to see most of the bodies.
        return Math.pow(mass, 1 / 3) * 0.1;
        //return 1;
    }

    public radius_from_mass_piecewise(mass: number): number {
        function f(x: number): number {
            return 800 * x + 0.005;
        }

        function g(x: number): number {
            return 1.8 * (x - MassThresholds.GAS_GIANT) + f(MassThresholds.GAS_GIANT);
        }

        function h(x: number): number {
            return 0.45 * (x - MassThresholds.BROWN_DWARF) + g(MassThresholds.BROWN_DWARF);
        }

        function j(x: number): number {
            return 0.025 * (x - MassThresholds.STAR) + h(MassThresholds.STAR);
        }

        function k(x: number): number {
            return 0.156 * (Math.pow(x, 0.57) - MassThresholds.SOLAR) + j(MassThresholds.SOLAR);
        }

        if (mass <= MassThresholds.GAS_GIANT) {
            return f(mass);
        } else if (mass <= MassThresholds.BROWN_DWARF) {
            return g(mass);
        } else if (mass <= MassThresholds.STAR) {
            return h(mass);
        } else if (mass <= MassThresholds.SOLAR) {
            return j(mass);
        } else {
            return k(mass);
        }
    }

    public radius_from_mass_B(mass: number): number {
        const earthMassInSolarMasses = 3.003e-6;
        const jupiterMassInSolarMasses = 0.0009543;
        const earthRadiusAU = 4.2635e-5;
        const jupiterRadiusAU = 0.0004778945;
        const sunRadiusAU = 0.00465047;

        if (mass < 0.003) {
            const massInEarthMasses = mass / earthMassInSolarMasses;
            const radiusInEarthRadii = Math.pow(massInEarthMasses, 0.28);
            return radiusInEarthRadii * earthRadiusAU * 2.5; // mild exaggeration
        } else if (mass < 0.08) {
            const massInJupiterMasses = mass / jupiterMassInSolarMasses;
            const radiusInJupiterRadii = 1.0 - 0.035 * Math.log10(massInJupiterMasses);
            return radiusInJupiterRadii * jupiterRadiusAU * 2; // slight boost
        } else {
            const radiusInSolarRadii = Math.pow(mass, 0.8);
            return radiusInSolarRadii * sunRadiusAU * 1.25; // subtle boost
        }
    }

    public initialize(): void {
        this.numActive = this.settings.numBodies;
        // Seed the random number generator with the provided seed
        const min_position = (-1.0 * this.settings.size) / 2;
        const max_position = this.settings.size / 2;

        // Velocities are in astronomical units per year
        // For reference, the Earth's total velocity is about 6.283 AU/year.
        // const min_velocity = 0.0;
        // const max_velocity = 3;

        for (let i = 0; i < this.settings.numBodies; i++) {
            // this.positionsX[i] = getRandomFloat(min_position, max_position);
            // this.positionsY[i] = getRandomFloat(-1, 1);
            // this.positionsZ[i] = getRandomFloat(min_position, max_position);

            const pos = this.getRandomDiskStartingPosition(min_position, max_position);
            this.positionsX[i] = pos.x;
            this.positionsY[i] = pos.y;
            this.positionsZ[i] = pos.z;

            // this.velocitiesX[i] = getRandomFloat(min_velocity, max_velocity);
            // this.velocitiesY[i] = getRandomFloat(min_velocity, max_velocity);
            // this.velocitiesZ[i] = getRandomFloat(min_velocity, max_velocity);

            const initialAngularVelocity = this.getInitialVelocityKepler(
                this.positionsX[i],
                this.positionsY[i],
                this.positionsZ[i],
                this.settings.starInCenter ? this.settings.centerStarMass : 1,
            );
            this.velocitiesX[i] = initialAngularVelocity.vX;
            this.velocitiesY[i] = initialAngularVelocity.vY;
            this.velocitiesZ[i] = initialAngularVelocity.vZ;

            this.bodiesActive[i] = 1;

            this.masses[i] = getRandomFloat(this.settings.minMass, this.settings.maxMass);
            this.radii[i] = this.radius_from_mass_piecewise(this.masses[i]);
        }

        // Set star in center if applicable
        if (this.settings.starInCenter) {
            const centerBody = getRandomInt(0, this.settings.numBodies - 1);
            this.masses[centerBody] = this.settings.centerStarMass;
            this.radii[centerBody] = this.radius_from_mass_piecewise(this.masses[centerBody]);
            this.positionsX[centerBody] = 0;
            this.positionsY[centerBody] = 0;
            this.positionsZ[centerBody] = 0;
            this.velocitiesX[centerBody] = 0;
            this.velocitiesY[centerBody] = 0;
            this.velocitiesZ[centerBody] = 0;
            this.bodiesActive[centerBody] = 1;
        }

        // Set colors
        // HSL to RGB conversion: https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB
        for (let i = 0; i < this.settings.numBodies; i++) {
            // Generating bright, saturated colors is easier in HSL
            const H = getRandomFloat(0, 360);
            const S = getRandomFloat(0.8, 0.9);
            const L = 0.8;

            // Convert HSL to RGB
            const colorRGB = HSLtoRGB(H, S, L);
            this.colorsR[i] = colorRGB.r;
            this.colorsG[i] = colorRGB.g;
            this.colorsB[i] = colorRGB.b;

            // this.colorsR[i] = getRandomFloat(0.2, 0.85);
            // this.colorsG[i] = getRandomFloat(0.2, 0.85);
            // this.colorsB[i] = getRandomFloat(0.2, 0.85);
        }

        this.setOrbitalInformation();
    }

    private clear(): void {
        this.bodiesActive.fill(0);
        this.positionsX.fill(0);
        this.positionsY.fill(0);
        this.positionsZ.fill(0);
        this.velocitiesX.fill(0);
        this.velocitiesY.fill(0);
        this.velocitiesZ.fill(0);
        this.accelerationsX.fill(0);
        this.accelerationsY.fill(0);
        this.accelerationsZ.fill(0);
        this.masses.fill(0);
        this.radii.fill(0);
        this.colorsR.fill(0);
        this.colorsG.fill(0);
        this.colorsB.fill(0);
        this.orbitalIndices.fill(-1);
        this.orbitalDistances.fill(-1);
        this.numActive = 0;
        this.numSattelites.fill(0);
        this.timeElapsed = 0;
    }

    public reset(): void {
        this.clear();
        this.initialize();
    }

    public updateEuler(deltaTime: number) {
        const dt = deltaTime * this.settings.timeStep;

        this.timeElapsed += dt;

        // Zero out all accelerations
        // Each fill operation, evidently, is done in O(n) time.
        this.accelerationsX.fill(0);
        this.accelerationsY.fill(0);
        this.accelerationsZ.fill(0);

        // Calculate acceleration
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (!this.bodiesActive[i]) {
                continue;
            }
            for (let j = 0; j < this.settings.numBodies; j++) {
                if (i === j || !this.bodiesActive[j]) {
                    continue;
                }

                // Calculate displacement
                const displacementX = this.positionsX[j] - this.positionsX[i];
                const displacementY = this.positionsY[j] - this.positionsY[i];
                const displacementZ = this.positionsZ[j] - this.positionsZ[i];

                // Calculates the magnitude of displacement
                const displacementMagSq =
                    displacementX * displacementX + displacementY * displacementY + displacementZ * displacementZ;
                const displacementMag = Math.sqrt(displacementMagSq);

                // Calculates the unit vector of the displacement
                const unitDisplacementX = displacementX / displacementMag;
                const unitDisplacementY = displacementY / displacementMag;
                const unitDisplacementZ = displacementZ / displacementMag;

                // Calculates the accelerations
                const acceleration = (G * this.masses[j]) / displacementMagSq;
                this.accelerationsX[i] += acceleration * unitDisplacementX;
                this.accelerationsY[i] += acceleration * unitDisplacementY;
                this.accelerationsZ[i] += acceleration * unitDisplacementZ;
            }
        }

        // Calculate new velocities and positions
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (!this.bodiesActive[i]) {
                continue;
            }
            this.velocitiesX[i] += this.accelerationsX[i] * dt;
            this.velocitiesY[i] += this.accelerationsY[i] * dt;
            this.velocitiesZ[i] += this.accelerationsZ[i] * dt;

            this.positionsX[i] += this.velocitiesX[i] * dt;
            this.positionsY[i] += this.velocitiesY[i] * dt;
            this.positionsZ[i] += this.velocitiesZ[i] * dt;
        }

        // Handle collisions
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (!this.bodiesActive[i]) {
                continue;
            }
            for (let j = 0; j < this.settings.numBodies; j++) {
                if (i === j || !this.bodiesActive[j]) {
                    continue;
                }

                // Calculate displacement
                const displacementX = this.positionsX[j] - this.positionsX[i];
                const displacementY = this.positionsY[j] - this.positionsY[i];
                const displacementZ = this.positionsZ[j] - this.positionsZ[i];

                // Calculates the magnitude of displacement
                const displacementMagSq =
                    displacementX * displacementX + displacementY * displacementY + displacementZ * displacementZ;
                const displacementMag = Math.sqrt(displacementMagSq);

                // Check for collision
                if (displacementMag < this.radii[i] + this.radii[j]) {
                    const most_massive = this.masses[i] > this.masses[j] ? i : j;
                    const less_massive = this.masses[i] > this.masses[j] ? j : i;

                    // Merge the masses
                    this.masses[most_massive] += this.masses[less_massive];
                    this.radii[most_massive] = this.radius_from_mass_piecewise(this.masses[most_massive]);
                    this.velocitiesX[most_massive] =
                        (this.velocitiesX[most_massive] * this.masses[most_massive] +
                            this.velocitiesX[less_massive] * this.masses[less_massive]) /
                        this.masses[most_massive];
                    this.velocitiesY[most_massive] =
                        (this.velocitiesY[most_massive] * this.masses[most_massive] +
                            this.velocitiesY[less_massive] * this.masses[less_massive]) /
                        this.masses[most_massive];
                    this.velocitiesZ[most_massive] =
                        (this.velocitiesZ[most_massive] * this.masses[most_massive] +
                            this.velocitiesZ[less_massive] * this.masses[less_massive]) /
                        this.masses[most_massive];

                    /*
                        Deactivate the less massive body.
                    */
                    this.numActive--;
                    this.bodiesActive[less_massive] = 0;
                    if (less_massive === i) {
                        break;
                    }
                }
            }
        }

        /*
            Handle specific orbital energy
        */
        this.setOrbitalInformation();
    }

    private setOrbitalInformation() {
        /**
         * Sets the orbital indices, orbital distances and number of sattelites for each body
         */
        this.numSattelites.fill(0);
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (!this.bodiesActive[i]) {
                continue;
            }
            this.orbitalIndices[i] = -1;
            this.orbitalDistances[i] = -1;
            let lowestEnergy = 0;
            for (let j = 0; j < this.settings.numBodies; j++) {
                if (i === j || !this.bodiesActive[j]) {
                    continue;
                }

                // As a simplification, bodies cannot be consider to "orbit" bodies which are sufficiently
                if (this.masses[j] < this.masses[i] / 5.0) {
                    continue;
                }

                const energy = this.getSpecificOrbitalEnergy(i, j);
                if (energy < lowestEnergy) {
                    lowestEnergy = energy;
                    this.orbitalIndices[i] = j;
                }
            }
            if (this.orbitalIndices[i] !== -1) {
                this.numSattelites[this.orbitalIndices[i]]++;
                this.orbitalDistances[i] = Math.sqrt(
                    (this.positionsX[i] - this.positionsX[this.orbitalIndices[i]]) ** 2 +
                        (this.positionsY[i] - this.positionsY[this.orbitalIndices[i]]) ** 2 +
                        (this.positionsZ[i] - this.positionsZ[this.orbitalIndices[i]]) ** 2,
                );
            }
        }
    }

    public bodyDistance(a: number, b: number): number {
        /**
         * Absolute distance to the followed body. Returns -1 if there is no followed body.
         */

        const dTargetX = this.positionsX[b] - this.positionsX[a];
        const dTargetY = this.positionsY[b] - this.positionsY[a];
        const dTargetZ = this.positionsZ[b] - this.positionsZ[a];

        return Math.sqrt(dTargetX ** 2 + dTargetY ** 2 + dTargetZ ** 2);
    }

    public getActiveBodies(target: number): Array<LeaderboardBody> {
        const massRankings = new Array<LeaderboardBody>(this.numActive);
        let j = 0;
        for (let i = 0; i < this.settings.numBodies; i++) {
            // Skip inactive bodies
            if (!this.bodiesActive[i]) {
                continue;
            }

            massRankings[j] = {
                index: i,
                mass: this.masses[i],
                color: `rgb(${this.colorsR[i] * 255}, ${this.colorsG[i] * 255}, ${this.colorsB[i] * 255})`,
                dOrigin: Math.sqrt(this.positionsX[i] ** 2 + this.positionsY[i] ** 2 + this.positionsZ[i] ** 2),
                dTarget: target > -1 ? this.bodyDistance(target, i) : -1,
                orbiting: this.orbitalIndices[i],
                dOrbit: this.orbitalDistances[i],
                orbitColor: `rgb(${this.colorsR[this.orbitalIndices[i]] * 255}, ${this.colorsG[this.orbitalIndices[i]] * 255}, ${this.colorsB[this.orbitalIndices[i]] * 255})`,
                numSatellites: this.numSattelites[i],
            };

            j++;
        }

        return massRankings;
    }

    public isStar(idx: number) {
        return this.bodiesActive[idx] && this.masses[idx] >= MassThresholds.STAR;
    }

    public getStarData(): Array<vec4> {
        const stars = new Array<vec4>();
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (this.isStar(i)) {
                stars.push(vec4.fromValues(this.positionsX[i], this.positionsY[i], this.positionsZ[i], this.masses[i]));
            }
        }

        stars.sort((a, b) => b[3] - a[3]); // Sort by mass
        return stars;
    }

    public getNumStars(): number {
        let numStars = 0;
        for (let i = 0; i < this.settings.numBodies; i++) {
            if (this.isStar(i)) {
                numStars++;
            }
        }
        return numStars;
    }

    public getInitialVelocityOriginal(x: number, y: number, z: number): { x: number; y: number; z: number } {
        // Planets in the center move slower than planets on the edge of the universe.
        // The velocity is proportional to the distance from the center of the universe.
        const distanceFromCenter = Math.sqrt(x * x + y * y + z * z);
        const angularVelocityMagnitude = Math.sqrt(G / distanceFromCenter); // Gravitational acceleration
        // The angular velocity is perpendicular to the radius vector.
        // We can use the cross product to get the angular velocity vector.
        const angularVelocityX = -z * angularVelocityMagnitude * 0.05;
        const angularVelocityY = 0;
        const angularVelocityZ = x * angularVelocityMagnitude * 0.05; // No vertical component for simplicity
        return {
            x: angularVelocityX,
            y: angularVelocityY,
            z: angularVelocityZ,
        };
    }

    private getInitialVelocityKepler(
        x: number,
        y: number,
        z: number,
        M: number,
    ): { vX: number; vY: number; vZ: number } {
        // Planets in the center move slower than planets on the edge of the universe.
        // The velocity is proportional to the distance from the center of the universe.
        const positionVector = vec3.fromValues(x, y, z);
        const perpendicularUnitVector = vec3.create();
        vec3.cross(perpendicularUnitVector, positionVector, vec3.fromValues(0, 1, 0)); // Perpendicular to the position vector
        vec3.normalize(perpendicularUnitVector, perpendicularUnitVector); // Normalize the vector
        const distanceFromCenter = vec3.length(positionVector);
        const angularVelocityMagnitude = Math.sqrt((G * M) / distanceFromCenter); // Gravitational acceleration

        const velocityVector = vec3.create();
        vec3.scale(velocityVector, perpendicularUnitVector, angularVelocityMagnitude); // Scale the vector by the angular velocity

        return { vX: velocityVector[0], vY: velocityVector[1], vZ: velocityVector[2] };
    }

    // private getRandomSphericalStartingPosition(min: number, max: number): { x: number; y: number; z: number } {
    //     const theta = getRandomFloat(0, Math.PI * 2); // Random angle around the z-axis
    //     const phi = getRandomFloat(0, Math.PI); // Random angle from the z-axis
    //     const radius = getRandomFloat(min, max); // Random radius

    //     return {
    //         x: radius * Math.sin(phi) * Math.cos(theta),
    //         y: radius * Math.sin(phi) * Math.sin(theta),
    //         z: radius * Math.cos(phi),
    //     };
    // }

    private getRandomDiskStartingPosition(min: number, max: number): { x: number; y: number; z: number } {
        const theta = getRandomFloat(0, Math.PI * 2); // Random angle around the z-axis
        const phi = getRandomFloat(0, Math.PI); // Random angle from the z-axis
        const radius = getRandomFloat(min, max); // Random radius

        return {
            x: radius * Math.sin(phi) * Math.cos(theta),
            y: getRandomFloat(-1, 1), // Random y position
            z: radius * Math.cos(phi),
        };
    }

    private getSpecificOrbitalEnergy(bodyA: number, bodyB: number) {
        // Relative velocities
        const vX = this.velocitiesX[bodyA] - this.velocitiesX[bodyB];
        const vY = this.velocitiesY[bodyA] - this.velocitiesY[bodyB];
        const vZ = this.velocitiesZ[bodyA] - this.velocitiesZ[bodyB];
        const v = Math.sqrt(vX * vX + vY * vY + vZ * vZ);

        // Relative distance
        const dX = this.positionsX[bodyA] - this.positionsX[bodyB];
        const dY = this.positionsY[bodyA] - this.positionsY[bodyB];
        const dZ = this.positionsZ[bodyA] - this.positionsZ[bodyB];
        const r = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

        // Sum of standard gravitational patterns
        const U = G * (this.masses[bodyA] + this.masses[bodyB]);

        return 0.5 * v * v - U / r;
    }

    /*
        Getters
    */
    public getRadius(idx: number): number {
        return this.radii[idx];
    }
    public getMass(idx: number): number {
        return this.masses[idx];
    }
    public getPositionX(idx: number): number {
        return this.positionsX[idx];
    }
    public getPosition(idx: number): vec3 {
        return vec3.fromValues(this.positionsX[idx], this.positionsY[idx], this.positionsZ[idx]);
    }
    public getVelocity(idx: number): vec3 {
        return vec3.fromValues(this.velocitiesX[idx], this.velocitiesY[idx], this.velocitiesZ[idx]);
    }
    public getAcceleration(idx: number): vec3 {
        return vec3.fromValues(this.accelerationsX[idx], this.accelerationsY[idx], this.accelerationsZ[idx]);
    }
}
