// ============================================
// SIMULADOR DE PROCESADOR RISC-V MONOCICLO
// ============================================

/**
 * Estado del procesador
 */
const processor = {
    // Banco de 32 registros de 32 bits
    registers: Array(32).fill(0),
    
    // Memoria de datos (256 palabras de 32 bits)
    memory: Array(256).fill(0),
    
    // Program Counter
    pc: 0,
    
    // Lista de instrucciones del programa
    instructions: [
        'addi x1, x0, 10',    // x1 = 10
        'addi x2, x0, 20',    // x2 = 20
        'add x3, x1, x2',     // x3 = x1 + x2 = 30
        'sub x4, x2, x1',     // x4 = x2 - x1 = 10
    ],
    
    // Señales de control
    controlSignals: {
        RegWrite: false,
        ALUSrc: false,
        MemWrite: false,
        MemRead: false,
        MemToReg: false,
        Branch: false,
        ALUOp: '00'
    },
    
    // Valores internos del ciclo actual
    internals: {
        instruction: '',
        opcode: 0,
        rd: 0,
        rs1: 0,
        rs2: 0,
        funct3: 0,
        funct7: 0,
        imm: 0,
        aluResult: 0,
        readData1: 0,
        readData2: 0,
        memData: 0
    },
    
    // Log de ejecución
    executionLog: [],
    
    // Estado de ejecución automática
    isRunning: false
};

// ============================================
// FUNCIONES DE DECODIFICACIÓN DE INSTRUCCIONES
// ============================================

/**
 * Parsear una instrucción de texto a sus componentes
 * @param {string} instrText - Texto de la instrucción (ej: "add x1, x2, x3")
 * @returns {Object} - Objeto con opcode y registros
 */
function parseInstruction(instrText) {
    // Limpiar y separar la instrucción
    const parts = instrText.trim().toLowerCase().replace(/,/g, '').split(/\s+/);
    const opcode = parts[0];
    
    // Extraer registros y valores inmediatos
    const regs = parts.slice(1).map(r => {
        if (r.startsWith('x')) {
            return parseInt(r.substring(1));
        }
        // Si es un número inmediato
        return parseInt(r);
    });
    
    return { opcode, regs };
}

/**
 * Obtener el código de operación binario según el mnemónico
 * @param {string} mnemonic - Mnemónico de la instrucción
 * @returns {number} - Código de operación
 */
function getOpcodeValue(mnemonic) {
    const opcodes = {
        // Tipo R (operaciones entre registros)
        'add': 0b0110011, 'sub': 0b0110011, 'and': 0b0110011,
        'or': 0b0110011, 'xor': 0b0110011, 'slt': 0b0110011,
        'sltu': 0b0110011, 'sll': 0b0110011, 'srl': 0b0110011,
        'sra': 0b0110011,
        
        // Tipo I (operaciones con inmediatos)
        'addi': 0b0010011, 'andi': 0b0010011, 'ori': 0b0010011,
        'xori': 0b0010011, 'slti': 0b0010011, 'sltiu': 0b0010011,
        'slli': 0b0010011, 'srli': 0b0010011, 'srai': 0b0010011,
        
        // Tipo I (load - carga desde memoria)
        'lw': 0b0000011, 'lh': 0b0000011, 'lb': 0b0000011,
        'lhu': 0b0000011, 'lbu': 0b0000011,
        
        // Tipo S (store - almacenamiento en memoria)
        'sw': 0b0100011, 'sh': 0b0100011, 'sb': 0b0100011,
        
        // Tipo B (branch - saltos condicionales)
        'beq': 0b1100011, 'bne': 0b1100011, 'blt': 0b1100011,
        'bge': 0b1100011, 'bltu': 0b1100011, 'bgeu': 0b1100011
    };
    
    return opcodes[mnemonic] || 0;
}

/**
 * Obtener el campo funct3 de la instrucción
 * @param {string} mnemonic - Mnemónico de la instrucción
 * @returns {number} - Valor de funct3
 */
function getFunct3(mnemonic) {
    const funct3Map = {
        // Tipo R
        'add': 0b000, 'sub': 0b000, 'sll': 0b001, 'slt': 0b010,
        'sltu': 0b011, 'xor': 0b100, 'srl': 0b101, 'sra': 0b101,
        'or': 0b110, 'and': 0b111,
        
        // Tipo I (operaciones)
        'addi': 0b000, 'slti': 0b010, 'sltiu': 0b011, 'xori': 0b100,
        'ori': 0b110, 'andi': 0b111, 'slli': 0b001, 'srli': 0b101,
        'srai': 0b101,
        
        // Tipo I (load)
        'lb': 0b000, 'lh': 0b001, 'lw': 0b010, 'lbu': 0b100, 'lhu': 0b101,
        
        // Tipo S
        'sb': 0b000, 'sh': 0b001, 'sw': 0b010,
        
        // Tipo B
        'beq': 0b000, 'bne': 0b001, 'blt': 0b100, 'bge': 0b101,
        'bltu': 0b110, 'bgeu': 0b111
    };
    
    return funct3Map[mnemonic] || 0;
}

/**
 * Obtener el campo funct7 para instrucciones tipo R
 * @param {string} mnemonic - Mnemónico de la instrucción
 * @returns {number} - Valor de funct7
 */
function getFunct7(mnemonic) {
    const funct7Map = {
        'sub': 0b0100000,
        'sra': 0b0100000,
        'srai': 0b0100000
    };
    
    return funct7Map[mnemonic] || 0b0000000;
}

// ============================================
// FUNCIONES DE LA ALU
// ============================================

/**
 * Ejecutar operación en la ALU
 * @param {string} op - Operación a realizar
 * @param {number} a - Operando A
 * @param {number} b - Operando B
 * @param {number} funct3 - Campo funct3
 * @param {number} funct7 - Campo funct7
 * @returns {number} - Resultado de la operación
 */
function executeALU(op, a, b, funct3, funct7) {
    // Convertir a enteros de 32 bits con signo
    const toSigned32 = (n) => {
        n = n | 0; // Convertir a int32
        return n;
    };
    
    a = toSigned32(a);
    b = toSigned32(b);
    
    switch (funct3) {
        case 0b000: // ADD/SUB
            if (funct7 === 0b0100000) {
                return a - b; // SUB
            }
            return a + b; // ADD
            
        case 0b001: // SLL (shift left logical)
            return a << (b & 0x1F);
            
        case 0b010: // SLT (set less than)
            return a < b ? 1 : 0;
            
        case 0b011: // SLTU (set less than unsigned)
            return (a >>> 0) < (b >>> 0) ? 1 : 0;
            
        case 0b100: // XOR
            return a ^ b;
            
        case 0b101: // SRL/SRA (shift right)
            if (funct7 === 0b0100000) {
                return a >> (b & 0x1F); // SRA (arithmetic)
            }
            return a >>> (b & 0x1F); // SRL (logical)
            
        case 0b110: // OR
            return a | b;
            
        case 0b111: // AND
            return a & b;
            
        default:
            return 0;
    }
}

// ============================================
// EJECUCIÓN DE INSTRUCCIONES
// ============================================

/**
 * Ejecutar la instrucción actual apuntada por el PC
 */
function executeInstruction() {
    // Verificar si hay instrucciones para ejecutar
    if (processor.pc >= processor.instructions.length) {
        addToLog('⚠ Fin del programa');
        processor.isRunning = false;
        updateUI();
        return;
    }
    
    // Obtener la instrucción actual
    const instrText = processor.instructions[processor.pc];
    const { opcode: mnemonic, regs } = parseInstruction(instrText);
    
    // Decodificar la instrucción
    const opcodeValue = getOpcodeValue(mnemonic);
    const funct3 = getFunct3(mnemonic);
    const funct7 = getFunct7(mnemonic);
    
    let aluResult = 0;
    let logMessage = '';
    let newPC = processor.pc + 1;
    
    // Determinar el tipo de instrucción
    const isRType = opcodeValue === 0b0110011;
    const isIType = opcodeValue === 0b0010011;
    const isLoad = opcodeValue === 0b0000011;
    const isStore = opcodeValue === 0b0100011;
    const isBranch = opcodeValue === 0b1100011;
    
    // ========== TIPO R (Operaciones entre registros) ==========
    if (isRType) {
        const rd = regs[0];   // Registro destino
        const rs1 = regs[1];  // Registro fuente 1
        const rs2 = regs[2];  // Registro fuente 2
        
        const val1 = processor.registers[rs1];
        const val2 = processor.registers[rs2];
        
        // Ejecutar operación en la ALU
        aluResult = executeALU(mnemonic, val1, val2, funct3, funct7);
        
        // Escribir resultado (x0 siempre es 0)
        if (rd !== 0) {
            processor.registers[rd] = aluResult;
        }
        
        logMessage = `${mnemonic.toUpperCase()} x${rd}, x${rs1}, x${rs2} → x${rd} = ${aluResult}`;
        
        // Configurar señales de control
        processor.controlSignals = {
            RegWrite: true,
            ALUSrc: false,
            MemWrite: false,
            MemRead: false,
            MemToReg: false,
            Branch: false,
            ALUOp: '10'
        };
        
        // Actualizar valores internos
        processor.internals.readData1 = val1;
        processor.internals.readData2 = val2;
        processor.internals.aluResult = aluResult;
    }
    
    // ========== TIPO I (Operaciones con inmediatos) ==========
    else if (isIType) {
        const rd = regs[0];   // Registro destino
        const rs1 = regs[1];  // Registro fuente
        const imm = regs[2];  // Valor inmediato
        const val1 = processor.registers[rs1];
        
        // Ejecutar operación en la ALU
        aluResult = executeALU(mnemonic, val1, imm, funct3, funct7);
        
        // Escribir resultado
        if (rd !== 0) {
            processor.registers[rd] = aluResult;
        }
        
        logMessage = `${mnemonic.toUpperCase()} x${rd}, x${rs1}, ${imm} → x${rd} = ${aluResult}`;
        
        // Configurar señales de control
        processor.controlSignals = {
            RegWrite: true,
            ALUSrc: true,
            MemWrite: false,
            MemRead: false,
            MemToReg: false,
            Branch: false,
            ALUOp: '10'
        };
        
        // Actualizar valores internos
        processor.internals.readData1 = val1;
        processor.internals.readData2 = imm;
        processor.internals.imm = imm;
        processor.internals.aluResult = aluResult;
    }
    
    // ========== TIPO L (Load - Carga desde memoria) ==========
    else if (isLoad) {
        const rd = regs[0];        // Registro destino
        const rs1 = regs[1];       // Registro base
        const offset = regs[2] || 0; // Desplazamiento
        
        // Calcular dirección de memoria
        const addr = processor.registers[rs1] + offset;
        const memIndex = Math.floor(addr / 4) % 256;
        const memValue = processor.memory[memIndex];
        
        // Cargar valor en el registro
        if (rd !== 0) {
            processor.registers[rd] = memValue;
        }
        
        logMessage = `${mnemonic.toUpperCase()} x${rd}, ${offset}(x${rs1}) → x${rd} = MEM[${addr}] = ${memValue}`;
        
        // Configurar señales de control
        processor.controlSignals = {
            RegWrite: true,
            ALUSrc: true,
            MemWrite: false,
            MemRead: true,
            MemToReg: true,
            Branch: false,
            ALUOp: '00'
        };
        
        // Actualizar valores internos
        processor.internals.readData1 = processor.registers[rs1];
        processor.internals.imm = offset;
        processor.internals.aluResult = addr;
        processor.internals.memData = memValue;
    }
    
    // ========== TIPO S (Store - Almacenamiento en memoria) ==========
    else if (isStore) {
        const rs2 = regs[0];       // Registro fuente (datos a guardar)
        const rs1 = regs[1];       // Registro base
        const offset = regs[2] || 0; // Desplazamiento
        
        // Calcular dirección de memoria
        const addr = processor.registers[rs1] + offset;
        const memIndex = Math.floor(addr / 4) % 256;
        
        // Guardar valor en memoria
        processor.memory[memIndex] = processor.registers[rs2];
        
        logMessage = `${mnemonic.toUpperCase()} x${rs2}, ${offset}(x${rs1}) → MEM[${addr}] = ${processor.registers[rs2]}`;
        
        // Configurar señales de control
        processor.controlSignals = {
            RegWrite: false,
            ALUSrc: true,
            MemWrite: true,
            MemRead: false,
            MemToReg: false,
            Branch: false,
            ALUOp: '00'
        };
        
        // Actualizar valores internos
        processor.internals.readData1 = processor.registers[rs1];
        processor.internals.readData2 = processor.registers[rs2];
        processor.internals.imm = offset;
        processor.internals.aluResult = addr;
    }
    
    // ========== TIPO B (Branch - Saltos condicionales) ==========
    else if (isBranch) {
        const rs1 = regs[0];       // Primer registro a comparar
        const rs2 = regs[1];       // Segundo registro a comparar
        const offset = regs[2] || 1; // Desplazamiento del salto
        
        const val1 = processor.registers[rs1];
        const val2 = processor.registers[rs2];
        
        let takeBranch = false;
        
        // Evaluar condición de salto
        switch (funct3) {
            case 0b000: // BEQ (branch if equal)
                takeBranch = val1 === val2;
                break;
            case 0b001: // BNE (branch if not equal)
                takeBranch = val1 !== val2;
                break;
            case 0b100: // BLT (branch if less than)
                takeBranch = val1 < val2;
                break;
            case 0b101: // BGE (branch if greater or equal)
                takeBranch = val1 >= val2;
                break;
            case 0b110: // BLTU (branch if less than unsigned)
                takeBranch = (val1 >>> 0) < (val2 >>> 0);
                break;
            case 0b111: // BGEU (branch if greater or equal unsigned)
                takeBranch = (val1 >>> 0) >= (val2 >>> 0);
                break;
        }
        
        // Actualizar PC si se toma el salto
        if (takeBranch) {
            newPC = processor.pc + offset;
            logMessage = `${mnemonic.toUpperCase()} x${rs1}, x${rs2}, ${offset} → SALTO TOMADO (PC = ${newPC})`;
        } else {
            logMessage = `${mnemonic.toUpperCase()} x${rs1}, x${rs2}, ${offset} → SALTO NO TOMADO`;
        }
        
        // Configurar señales de control
        processor.controlSignals = {
            RegWrite: false,
            ALUSrc: false,
            MemWrite: false,
            MemRead: false,
            MemToReg: false,
            Branch: true,
            ALUOp: '01'
        };
        
        // Actualizar valores internos
        processor.internals.readData1 = val1;
        processor.internals.readData2 = val2;
        processor.internals.imm = offset;
    }
    
    // Actualizar PC
    processor.pc = newPC;
    
    // Agregar al log
    addToLog(`[${processor.pc - 1}] ${logMessage}`);
    
    // Actualizar interfaz
    updateUI();
}

// ============================================
// FUNCIONES DE CONTROL
// ============================================

/**
 * Ejecutar un paso (una instrucción)
 */
function stepExecution() {
    if (processor.pc < processor.instructions.length) {
        executeInstruction();
    }
}

/**
 * Ejecutar todo el programa automáticamente
 */
function runProgram() {
    processor.isRunning = true;
    
    const runInterval = setInterval(() => {
        if (processor.pc < processor.instructions.length && processor.isRunning) {
            executeInstruction();
        } else {
            processor.isRunning = false;
            clearInterval(runInterval);
            updateUI();
        }
    }, 500); // Ejecutar cada 500ms
}

/**
 * Reiniciar el procesador
 */
function resetProcessor() {
    processor.registers = Array(32).fill(0);
    processor.memory = Array(256).fill(0);
    processor.pc = 0;
    processor.executionLog = [];
    processor.isRunning = false;
    processor.controlSignals = {
        RegWrite: false,
        ALUSrc: false,
        MemWrite: false,
        MemRead: false,
        MemToReg: false,
        Branch: false,
        ALUOp: '00'
    };
    processor.internals = {
        instruction: '',
        opcode: 0,
        rd: 0,
        rs1: 0,
        rs2: 0,
        funct3: 0,
        funct7: 0,
        imm: 0,
        aluResult: 0,
        readData1: 0,
        readData2: 0,
        memData: 0
    };
    
    updateUI();
}

/**
 * Agregar una instrucción al programa
 * @param {string} instruction - Instrucción a agregar
 */
function addInstruction(instruction) {
    if (instruction.trim()) {
        processor.instructions.push(instruction.trim());
        updateInstructionList();
    }
}

/**
 * Eliminar una instrucción del programa
 * @param {number} index - Índice de la instrucción a eliminar
 */
function deleteInstruction(index) {
    processor.instructions.splice(index, 1);
    
    // Ajustar PC si es necesario
    if (processor.pc >= processor.instructions.length) {
        processor.pc = 0;
    }
    
    updateInstructionList();
    updateUI();
}

/**
 * Agregar mensaje al log de ejecución
 * @param {string} message - Mensaje a agregar
 */
function addToLog(message) {
    processor.executionLog.push(message);
    updateExecutionLog();
}

// ============================================
// FUNCIONES DE ACTUALIZACIÓN DE UI
// ============================================

/**
 * Actualizar toda la interfaz
 */
function updateUI() {
    updateRegisterBank();
    updateMemoryBank();
    updateControlSignals();
    updateALU();
    updatePCInfo();
    updateInstructionList();
}

/**
 * Actualizar la lista de instrucciones
 */
function updateInstructionList() {
    const listContainer = document.getElementById('instructionList');
    listContainer.innerHTML = '';
    
    processor.instructions.forEach((instr, index) => {
        const item = document.createElement('div');
        item.className = 'instruction-item' + (index === processor.pc ? ' active' : '');
        
        item.innerHTML = `
            <span class="instruction-index">${index}:</span>
            <span class="instruction-text">${instr}</span>
            <button class="delete-btn" onclick="deleteInstruction(${index})">🗑️</button>
        `;
        
        listContainer.appendChild(item);
    });
}

/**
 * Actualizar el banco de registros
 */
function updateRegisterBank() {
    const container = document.getElementById('registerBank');
    container.innerHTML = '';
    
    processor.registers.forEach((value, index) => {
        const regDiv = document.createElement('div');
        
        // Determinar clase CSS según el valor
        let className = 'register ';
        if (index === 0) {
            className += 'zero';
        } else if (value !== 0) {
            className += 'active';
        } else {
            className += 'inactive';
        }
        
        regDiv.className = className;
        regDiv.innerHTML = `
            <div class="register-name">x${index}</div>
            <div class="register-value">${value}</div>
        `;
        
        container.appendChild(regDiv);
    });
}

/**
 * Actualizar el banco de memoria
 */
function updateMemoryBank() {
    const container = document.getElementById('memoryBank');
    container.innerHTML = '';
    
    // Mostrar solo las primeras 32 palabras
    for (let i = 0; i < 32; i++) {
        const value = processor.memory[i];
        const memDiv = document.createElement('div');
        
        memDiv.className = 'memory-cell ' + (value !== 0 ? 'active' : 'inactive');
        memDiv.innerHTML = `
            <div class="memory-address">[${i * 4}]</div>
            <div class="memory-value">${value}</div>
        `;
        
        container.appendChild(memDiv);
    }
}

/**
 * Actualizar las señales de control
 */
function updateControlSignals() {
    const container = document.getElementById('controlSignals');
    container.innerHTML = '';
    
    Object.entries(processor.controlSignals).forEach(([signal, value]) => {
        const signalDiv = document.createElement('div');
        signalDiv.className = 'control-signal ' + (value ? 'active' : 'inactive');
        signalDiv.innerHTML = `
            <div class="signal-name">${signal}</div>
            <div class="signal-value">${value.toString()}</div>
        `;
        
        container.appendChild(signalDiv);
    });
}

/**
 * Actualizar la visualización de la ALU
 */
function updateALU() {
    document.getElementById('aluOperandA').textContent = processor.internals.readData1;
    document.getElementById('aluOperandB').textContent = processor.internals.readData2 || processor.internals.imm;
    document.getElementById('aluResult').textContent = processor.internals.aluResult;
}

/**
 * Actualizar información del PC
 */
function updatePCInfo() {
    document.getElementById('pcValue').textContent = processor.pc;
    document.getElementById('currentInstruction').textContent = 
        processor.pc < processor.instructions.length 
            ? processor.instructions[processor.pc] 
            : 'N/A';
}

/**
 * Actualizar el log de ejecución
 */
function updateExecutionLog() {
    const logContainer = document.getElementById('executionLog');
    
    if (processor.executionLog.length === 0) {
        logContainer.innerHTML = '<div class="log-empty">No hay ejecuciones todavía...</div>';
    } else {
        logContainer.innerHTML = processor.executionLog
            .map(entry => `<div class="log-entry">${entry}</div>`)
            .join('');
        
        // Scroll al final
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Botón: Ejecutar paso
    document.getElementById('stepBtn').addEventListener('click', stepExecution);
    
    // Botón: Ejecutar todo
    document.getElementById('runBtn').addEventListener('click', runProgram);
    
    // Botón: Reiniciar
    document.getElementById('resetBtn').addEventListener('click', resetProcessor);
    
    // Botón: Agregar instrucción
    document.getElementById('addInstructionBtn').addEventListener('click', () => {
        const input = document.getElementById('newInstructionInput');
        addInstruction(input.value);
        input.value = '';
    });
    
    // Enter en el input de instrucciones
    document.getElementById('newInstructionInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = document.getElementById('newInstructionInput');
            addInstruction(input.value);
            input.value = '';
        }
    });
    
    // Inicializar UI
    updateUI();
});
