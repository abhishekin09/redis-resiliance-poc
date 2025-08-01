-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO users (name, phone_number, email) VALUES
('John Doe', '+1234567890', 'john.doe@example.com'),
('Jane Smith', '+1987654321', 'jane.smith@example.com'),
('Bob Johnson', '+1122334455', 'bob.johnson@example.com'),
('Alice Brown', '+1555666777', 'alice.brown@example.com'),
('Charlie Wilson', '+1888999000', 'charlie.wilson@example.com')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    email = VALUES(email); 